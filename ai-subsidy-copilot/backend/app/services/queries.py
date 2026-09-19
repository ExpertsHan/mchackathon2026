"""Read models for citizen tracking and reviewer screens."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.enums import ActorType, ApplicationStatus, RiskLevel
from app.models import Application, AuditLog, Payment, SourceDocument, SourceReview, User
from app.schemas.api import (
    AdminApplicationRow,
    AdminApplicationsResponse,
    AdminStats,
    ApplicationDetail,
    CitizenApplicationDetail,
    CitizenAuditLogRead,
    TimelineEvent,
    TimelineResponse,
)
from app.schemas.domain import (
    ApplicationRead,
    AuditLogRead,
    EligibilityCheck,
    EligibilityEvaluation,
    PaymentRead,
    UserRead,
)
from app.schemas.policy import PolicyCitation
from app.services.applications import get_application_by_public_id
from app.services.eligibility import evaluate_application, evaluation_from_review
from app.services.safety import get_safety_progress
from app.services.source_review import review_payload

TIMELINE_LABELS = {
    "APPLICATION_CREATED": "Application created",
    "SOURCE_APPLICANT_UPDATED": "Applicant details saved",
    "SOURCE_DOCUMENT_UPLOADED": "Document uploaded and read by OCR",
    "SOURCE_REVIEW_COMPLETED": "Rules RULE-001~020 evaluated",
    "POLICY_RETRIEVED": "Relevant policy retrieved",
    "ELIGIBILITY_EVALUATED": "Eligibility evaluated",
    "SAFETY_MODULE_COMPLETED": "AI safety module completed",
    "APPLICATION_SUBMITTED": "Application submitted",
    "APPLICATION_RESUBMITTED": "Supplement submitted",
    "APPLICATION_VERIFICATION_STARTED": "Verification started",
    "MANUAL_REVIEW_TRIGGERED": "Human review required",
    "MANUAL_REVIEW_RECHECKED": "Reviewer re-ran the checks",
    "FLAGGED_FOR_FURTHER_CHECK": "Flagged for further checks",
    "MORE_INFORMATION_REQUESTED": "More information requested",
    "APPLICATION_APPROVED": "Application approved",
    "APPLICATION_REJECTED": "Application rejected",
    "APPLICATION_CANCELLED": "Application cancelled",
    "LINE_NOTIFICATION_SENT": "LINE notification sent",
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
    ApplicationStatus.CANCELLED,
}
PUBLIC_AUDIT_REDACTED_KEYS = {
    "account_email",
    "email",
    "receipt_hash",
    "sha256",
    "storage_filename",
    "storage_path",
}


def _recorded_eligibility(db: Session, application: Application) -> EligibilityEvaluation | None:
    if application.status not in FINALIZED_OR_REVIEW_STATUSES:
        return None
    review = db.get(SourceReview, application.id)
    if review is not None and review.evaluation:
        evaluation = evaluation_from_review(review.evaluation)
        if evaluation is not None:
            return evaluation.model_copy(
                update={"approved_amount_twd": Decimal(application.approved_amount_twd or 0)}
            )
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
    recorded = _recorded_eligibility(db, application)
    if recorded is not None:
        return recorded
    if application.status in {ApplicationStatus.DRAFT, ApplicationStatus.REQUESTED_INFORMATION}:
        return evaluate_application(db, application, persist=False)
    return None


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
        if not log.action.startswith("SAFETY_")
    ]
    return TimelineResponse(
        public_id=application.public_id,
        status=application.status,
        events=events,
        payment=PaymentRead.model_validate(application.payment) if application.payment else None,
    )


MINUTES_MANUAL_PER_CASE = 20
MINUTES_AI_ASSISTED_PER_CASE = 5


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

    documents = db.scalars(select(SourceDocument)).all()
    fields_extracted = 0
    ocr_processed = 0
    for document in documents:
        fields = [
            key
            for key, value in document.ocr_data.items()
            if not key.startswith("_") and value not in (None, "")
        ]
        if fields:
            ocr_processed += 1
            fields_extracted += len(fields)

    submitted = db.scalars(
        select(SourceReview)
        .join(Application, SourceReview.application_id == Application.id)
        .where(Application.submitted_at.is_not(None))
    ).all()
    rules_total = rules_passed = issues = 0
    for review in submitted:
        rules = review.evaluation.get("rules", [])
        rules_total += len(rules)
        passed = sum(1 for rule in rules if not rule.get("result"))
        rules_passed += passed
        issues += len(rules) - passed
    supplements = (
        db.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == "MORE_INFORMATION_REQUESTED",
                AuditLog.actor_type == ActorType.RULE_ENGINE,
            )
        )
        or 0
    )
    needs_human = count(ApplicationStatus.MANUAL_REVIEW) + count(
        ApplicationStatus.REQUESTED_INFORMATION
    )
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
        cancelled=count(ApplicationStatus.CANCELLED),
        total_approved_subsidy=Decimal(approved_total or 0),
        total_paid_amount=Decimal(paid_total or 0),
        documents_uploaded=len(documents),
        documents_ocr_processed=ocr_processed,
        ocr_fields_extracted=fields_extracted,
        applications_submitted=len(submitted),
        rules_total_checked=rules_total,
        rules_auto_passed=rules_passed,
        issues_found=issues,
        supplement_notifications_sent=int(supplements),
        applications_needing_human_review=needs_human,
        estimated_minutes_saved=len(submitted)
        * (MINUTES_MANUAL_PER_CASE - MINUTES_AI_ASSISTED_PER_CASE),
        assumption_note=(
            f"估算假設：人工全程手動審核一件約 {MINUTES_MANUAL_PER_CASE} 分鐘，有 AI 輔助後承辦人員"
            f"只需複核 AI 標記重點約 {MINUTES_AI_ASSISTED_PER_CASE} 分鐘，僅供參考，非實測數字。"
        ),
    )


def admin_applications(
    db: Session,
    *,
    status: ApplicationStatus | None = None,
    product: str | None = None,
    risk_level: RiskLevel | None = None,
    ai_result: str | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> AdminApplicationsResponse:
    filters = []
    if status:
        filters.append(Application.status == status)
    if risk_level:
        filters.append(Application.risk_level == risk_level)
    if search:
        term = f"%{search.strip()}%"
        filters.append(or_(Application.public_id.ilike(term), User.name.ilike(term)))

    base = (
        select(Application, SourceReview)
        .join(User, Application.user_id == User.id)
        .outerjoin(SourceReview, SourceReview.application_id == Application.id)
        .where(*filters)
        .order_by(Application.created_at.desc())
    )
    rows = [
        (application, review)
        for application, review in db.execute(base.options(selectinload(Application.user))).all()
        if (not ai_result or (review is not None and review.evaluation.get("result") == ai_result))
        and (
            not product
            or (
                review is not None
                and (review.applicant_data.get("applied_tool_name") or "").casefold()
                == product.strip().casefold()
            )
        )
    ]
    return AdminApplicationsResponse(
        total=len(rows),
        items=[
            AdminApplicationRow(
                public_id=application.public_id,
                applicant=application.user.name,
                product=review.applicant_data.get("applied_tool_name") if review else None,
                applicant_type=review.applicant_data.get("applicant_type") if review else None,
                ai_result=review.evaluation.get("result") if review else None,
                flagged_for_check=application.flagged_for_check,
                requested_amount_twd=application.requested_amount_twd,
                approved_amount_twd=application.approved_amount_twd,
                risk_level=application.risk_level,
                status=application.status,
                submitted_at=application.submitted_at,
                created_at=application.created_at,
            )
            for application, review in rows[offset : offset + limit]
        ],
    )


def application_status(application: Application) -> dict:
    return {
        "public_id": application.public_id,
        "status": application.status,
        "information_request": application.information_request,
        "estimated_subsidy_twd": application.requested_amount_twd,
        "approved_amount_twd": application.approved_amount_twd,
        "updated_at": application.updated_at,
    }
