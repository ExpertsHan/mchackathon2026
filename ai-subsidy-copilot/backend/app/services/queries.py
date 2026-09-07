"""Read models for citizen tracking and reviewer screens."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.enums import ApplicationStatus, RiskLevel
from app.models import Application, AuditLog, Payment, Subscription, User
from app.schemas.api import (
    AdminApplicationRow,
    AdminApplicationsResponse,
    AdminStats,
    ApplicationDetail,
    CitizenApplicationDetail,
    CitizenAuditLogRead,
    CitizenSubscriptionRead,
    TimelineEvent,
    TimelineResponse,
)
from app.schemas.domain import (
    ApplicationRead,
    AuditLogRead,
    EligibilityCheck,
    EligibilityEvaluation,
    PaymentRead,
    SubscriptionRead,
    UserRead,
)
from app.schemas.policy import PolicyCitation
from app.services.applications import get_application_by_public_id
from app.services.eligibility import evaluate_application
from app.services.safety import get_safety_progress
from app.services.source_review import review_payload

TIMELINE_LABELS = {
    "APPLICATION_CREATED": "Application created",
    "SUBSCRIPTION_SELECTED": "Subscription selected",
    "RECEIPT_UPLOADED": "Receipt uploaded",
    "RECEIPT_PARSED": "Receipt analyzed",
    "POLICY_RETRIEVED": "Relevant policy retrieved",
    "ELIGIBILITY_EVALUATED": "Eligibility evaluated",
    "SAFETY_MODULE_COMPLETED": "AI safety module completed",
    "APPLICATION_SUBMITTED": "Application submitted",
    "APPLICATION_VERIFICATION_STARTED": "Verification started",
    "MANUAL_REVIEW_TRIGGERED": "Human review required",
    "MORE_INFORMATION_REQUESTED": "More information requested",
    "APPLICATION_APPROVED": "Application approved",
    "APPLICATION_REJECTED": "Application rejected",
    "PAYMENT_SCHEDULED": "Mock payment scheduled",
    "PAYMENT_COMPLETED": "Mock payment completed",
}

FINALIZED_OR_REVIEW_STATUSES = {
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.VERIFYING,
    ApplicationStatus.MANUAL_REVIEW,
    ApplicationStatus.REQUESTED_INFORMATION,
    ApplicationStatus.APPROVED,
    ApplicationStatus.REJECTED,
    ApplicationStatus.PAYMENT_SCHEDULED,
    ApplicationStatus.PAID,
}
PUBLIC_AUDIT_REDACTED_KEYS = {
    "account_email",
    "email",
    "receipt_hash",
    "sha256",
    "storage_filename",
    "storage_path",
}


def _recorded_eligibility(application: Application) -> EligibilityEvaluation | None:
    if application.status not in FINALIZED_OR_REVIEW_STATUSES:
        return None
    if application.eligibility_result is None or not application.eligibility_reasons_json:
        return None
    checks = [
        EligibilityCheck.model_validate(item) for item in application.eligibility_reasons_json
    ]
    outcome = application.eligibility_result
    eligible = outcome.value == "ELIGIBLE"
    return EligibilityEvaluation(
        eligible=eligible,
        provisionally_eligible=outcome.value == "PROVISIONALLY_ELIGIBLE",
        requires_manual_review=outcome.value == "MANUAL_REVIEW",
        outcome=outcome,
        approved_amount_twd=(
            Decimal(application.approved_amount_twd or 0) if eligible else Decimal("0.00")
        ),
        estimated_amount_twd=Decimal(
            application.requested_amount_twd or application.approved_amount_twd or 0
        ),
        checks=checks,
        risk_level=application.risk_level,
        risk_reasons=application.risk_reasons_json,
    )


def _eligibility_for_detail(db: Session, application: Application) -> EligibilityEvaluation | None:
    recorded = _recorded_eligibility(application)
    if recorded is not None:
        return recorded
    if application.status is ApplicationStatus.DRAFT:
        return evaluate_application(db, application, persist=False)
    return None


def citizen_subscription(subscription: Subscription) -> CitizenSubscriptionRead:
    return CitizenSubscriptionRead(
        id=subscription.id,
        provider=subscription.provider,
        product=subscription.product,
        amount=subscription.amount,
        currency=subscription.currency,
        amount_twd=subscription.amount_twd,
        purchase_date=subscription.purchase_date,
        receipt_filename=subscription.receipt_filename,
        receipt_reference=subscription.receipt_reference,
        extraction_confidence=subscription.extraction_confidence,
        extraction_warnings_json=subscription.extraction_warnings_json,
        suspicious_content=subscription.suspicious_content,
        receipt_uploaded=bool(subscription.receipt_hash),
        created_at=subscription.created_at,
    )


def _public_audit_details(value):
    if isinstance(value, dict):
        return {
            key: _public_audit_details(item)
            for key, item in value.items()
            if key.casefold() not in PUBLIC_AUDIT_REDACTED_KEYS
        }
    if isinstance(value, list):
        return [_public_audit_details(item) for item in value]
    return value


def application_detail(db: Session, public_id: str) -> ApplicationDetail:
    application = get_application_by_public_id(db, public_id)
    evaluation = _eligibility_for_detail(db, application)
    citations = [PolicyCitation.model_validate(item) for item in application.policy_citations_json]
    audit_logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.application_id == application.id)
        .order_by(AuditLog.created_at, AuditLog.id)
    ).all()
    return ApplicationDetail(
        application=ApplicationRead.model_validate(application),
        applicant=UserRead.model_validate(application.user),
        subscription=(
            SubscriptionRead.model_validate(application.subscription)
            if application.subscription
            else None
        ),
        eligibility=evaluation,
        payment=PaymentRead.model_validate(application.payment) if application.payment else None,
        citations=citations,
        audit_logs=[AuditLogRead.model_validate(item) for item in audit_logs],
        safety_progress=get_safety_progress(db, application.user_id),
        source_review=review_payload(db, application, citizen=False),
    )


def citizen_application_detail(db: Session, public_id: str) -> CitizenApplicationDetail:
    application = get_application_by_public_id(db, public_id)
    evaluation = _eligibility_for_detail(db, application)
    citations = [PolicyCitation.model_validate(item) for item in application.policy_citations_json]
    audit_logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.application_id == application.id)
        .order_by(AuditLog.created_at, AuditLog.id)
    ).all()
    return CitizenApplicationDetail(
        application=ApplicationRead.model_validate(application),
        applicant=UserRead.model_validate(application.user),
        subscription=(
            citizen_subscription(application.subscription) if application.subscription else None
        ),
        eligibility=evaluation,
        payment=PaymentRead.model_validate(application.payment) if application.payment else None,
        citations=citations,
        audit_logs=[
            CitizenAuditLogRead(
                id=item.id,
                actor_type=item.actor_type.value,
                action=item.action,
                details_json=_public_audit_details(item.details_json),
                created_at=item.created_at,
            )
            for item in audit_logs
        ],
        safety_progress=get_safety_progress(db, application.user_id),
        source_review=review_payload(db, application, citizen=True),
    )


def timeline(db: Session, public_id: str) -> TimelineResponse:
    application = get_application_by_public_id(db, public_id)
    audit_logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.application_id == application.id)
        .order_by(AuditLog.created_at, AuditLog.id)
    ).all()
    events = [
        TimelineEvent(
            action=log.action,
            label=TIMELINE_LABELS.get(log.action, log.action.replace("_", " ").title()),
            timestamp=log.created_at,
            actor_type=log.actor_type.value,
            details=_public_audit_details(log.details_json),
        )
        for log in audit_logs
    ]
    return TimelineResponse(
        public_id=application.public_id,
        status=application.status,
        events=events,
        payment=PaymentRead.model_validate(application.payment) if application.payment else None,
    )


def admin_stats(db: Session) -> AdminStats:
    rows = db.execute(
        select(Application.status, func.count(Application.id)).group_by(Application.status)
    ).all()
    counts = {status: count for status, count in rows}
    approved_total = db.scalar(
        select(func.coalesce(func.sum(Application.approved_amount_twd), 0)).where(
            Application.status.in_(
                {
                    ApplicationStatus.APPROVED,
                    ApplicationStatus.PAYMENT_SCHEDULED,
                    ApplicationStatus.PAID,
                }
            )
        )
    )
    paid_total = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_twd), 0)).where(Payment.status == "PAID")
    )
    count = lambda status: int(counts.get(status, 0))  # noqa: E731
    return AdminStats(
        total_applications=sum(counts.values()),
        draft=count(ApplicationStatus.DRAFT),
        submitted=count(ApplicationStatus.SUBMITTED),
        verifying=count(ApplicationStatus.VERIFYING),
        manual_review=count(ApplicationStatus.MANUAL_REVIEW),
        requested_information=count(ApplicationStatus.REQUESTED_INFORMATION),
        approved=count(ApplicationStatus.APPROVED),
        rejected=count(ApplicationStatus.REJECTED),
        payment_scheduled=count(ApplicationStatus.PAYMENT_SCHEDULED),
        paid=count(ApplicationStatus.PAID),
        total_approved_subsidy=Decimal(approved_total or 0),
        total_paid_amount=Decimal(paid_total or 0),
    )


def admin_applications(
    db: Session,
    *,
    status: ApplicationStatus | None = None,
    product: str | None = None,
    risk_level: RiskLevel | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> AdminApplicationsResponse:
    filters = []
    if status:
        filters.append(Application.status == status)
    if product:
        filters.append(func.lower(Subscription.product) == product.strip().lower())
    if risk_level:
        filters.append(Application.risk_level == risk_level)
    if search:
        term = f"%{search.strip()}%"
        filters.append(or_(Application.public_id.ilike(term), User.name.ilike(term)))

    base = (
        select(Application)
        .join(User, Application.user_id == User.id)
        .outerjoin(Subscription, Application.subscription_id == Subscription.id)
        .where(*filters)
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    applications = db.scalars(
        base.options(selectinload(Application.user), selectinload(Application.subscription))
        .order_by(Application.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return AdminApplicationsResponse(
        total=total,
        items=[
            AdminApplicationRow(
                public_id=application.public_id,
                applicant=application.user.name,
                product=application.subscription.product if application.subscription else None,
                requested_amount_twd=application.requested_amount_twd,
                approved_amount_twd=application.approved_amount_twd,
                risk_level=application.risk_level,
                status=application.status,
                submitted_at=application.submitted_at,
                created_at=application.created_at,
            )
            for application in applications
        ],
    )
