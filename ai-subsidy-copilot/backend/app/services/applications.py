"""Application lifecycle services used by citizen and reviewer APIs."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.enums import ActorType, ApplicationStatus, EligibilityOutcome
from app.core.errors import DomainError, ResourceNotFound
from app.models import Application, ApplicationIdSequence, User
from app.services.audit import record_audit
from app.services.claim_reservations import release_claim_keys, reserve_claim_keys
from app.services.eligibility import evaluate_application, subsidy_amount
from app.services.line_notify import notify_applicant, notify_status
from app.services.source_review import (
    OPEN_STATUSES,
    get_review,
    missing_applicant_fields,
    missing_documents,
    request_source_supplements,
)
from app.services.state_machine import transition_application


def generate_public_id(db: Session, *, now: datetime | None = None) -> str:
    """Allocate ``AI-YYYY-NNNNNN`` while the caller owns the transaction."""

    year = (now or datetime.now()).year
    sequence = db.scalar(
        select(ApplicationIdSequence).where(ApplicationIdSequence.year == year).with_for_update()
    )
    if sequence is None:
        prefix = f"AI-{year}-"
        existing_ids = db.scalars(
            select(Application.public_id).where(Application.public_id.like(f"{prefix}%"))
        ).all()
        existing_numbers = [
            int(public_id.removeprefix(prefix))
            for public_id in existing_ids
            if public_id.removeprefix(prefix).isdigit()
        ]
        sequence = ApplicationIdSequence(year=year, last_value=max(existing_numbers, default=0))
        db.add(sequence)
        db.flush()
    sequence.last_value += 1
    db.flush()
    return f"AI-{year}-{sequence.last_value:06d}"


def get_application_by_public_id(
    db: Session,
    public_id: str,
    *,
    for_update: bool = False,
) -> Application:
    query = (
        select(Application)
        .where(Application.public_id == public_id)
        .options(
            selectinload(Application.user),
            selectinload(Application.subscription),
            selectinload(Application.payment),
            selectinload(Application.audit_logs),
        )
    )
    if for_update:
        query = query.with_for_update()
    application = db.scalar(query)
    if application is None:
        raise ResourceNotFound("APPLICATION_NOT_FOUND", f"Application {public_id!r} was not found.")
    return application


def create_application(
    db: Session,
    user_id: uuid.UUID,
    *,
    actor_identifier: str | None = None,
) -> Application:
    user = db.get(User, user_id)
    if user is None:
        raise ResourceNotFound("USER_NOT_FOUND", "The selected demo applicant was not found.")
    open_application = db.scalar(
        select(Application.public_id).where(
            Application.user_id == user.id, Application.status.in_(OPEN_STATUSES)
        )
    )
    if open_application:
        raise DomainError(
            "ACTIVE_APPLICATION_EXISTS",
            "同一人同時間只能有一筆申請案，請先完成或取消目前的申請。",
            status_code=409,
            details={"public_id": open_application},
        )
    application = Application(public_id=generate_public_id(db), user_id=user.id)
    db.add(application)
    db.flush()
    record_audit(
        db,
        "APPLICATION_CREATED",
        ActorType.CITIZEN,
        actor_identifier or str(user.id),
        application=application,
        details={"public_id": application.public_id},
    )
    return application


def submit_application(
    db: Session,
    application: Application,
    *,
    actor_identifier: str | None = None,
) -> Application:
    """Submit for human review. The rule engine advises; it never approves or rejects."""

    if application.status not in {
        ApplicationStatus.DRAFT,
        ApplicationStatus.REQUESTED_INFORMATION,
    }:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "Only a draft or information-requested application can be submitted.",
            status_code=409,
        )
    review = get_review(db, application)
    incomplete = missing_applicant_fields(review)
    if not review.documents_required or incomplete:
        raise DomainError(
            "APPLICANT_DATA_INCOMPLETE",
            "申請資料尚未填寫完整：" + "、".join(incomplete or ["申請資料"]),
            status_code=400,
            details={"missing": incomplete},
        )
    absent = missing_documents(db, application)
    if absent:
        raise DomainError(
            "DOCUMENTS_INCOMPLETE",
            "文件尚未齊全：" + "、".join(item["label"] for item in absent),
            status_code=400,
            details={"missing": [item["label"] for item in absent]},
        )
    resubmission = application.submitted_at is not None

    transition_application(application, ApplicationStatus.SUBMITTED)
    application.information_request = None
    record_audit(
        db,
        "APPLICATION_RESUBMITTED" if resubmission else "APPLICATION_SUBMITTED",
        ActorType.CITIZEN,
        actor_identifier or str(application.user_id),
        application=application,
        details={"public_id": application.public_id},
    )
    transition_application(application, ApplicationStatus.VERIFYING)
    record_audit(
        db,
        "APPLICATION_VERIFICATION_STARTED",
        ActorType.SYSTEM,
        "policy-workflow-v1",
        application=application,
    )
    result = evaluate_application(db, application, persist=True)
    if result is None:
        raise DomainError(
            "SOURCE_REVIEW_UNAVAILABLE", "無法完成資料比對，請稍後再試。", status_code=503
        )
    transition_application(application, ApplicationStatus.MANUAL_REVIEW)
    record_audit(
        db,
        "MANUAL_REVIEW_TRIGGERED",
        ActorType.RULE_ENGINE,
        "ocr-rules-v1",
        application=application,
        details={
            "ai_result": result.ai_result,
            "risk_level": result.risk_level,
            "reasons": result.risk_reasons,
            "recommendation": "REJECT" if result.ai_result == "REJECT" else None,
        },
    )
    supplement_message = request_source_supplements(db, application)
    db.flush()
    if supplement_message:
        notify_status(db, application, detail=supplement_message)
    else:
        notify_status(db, application)
    return application


def cancel_application(
    db: Session, application: Application, *, actor_identifier: str | None = None
) -> Application:
    if application.status in {
        ApplicationStatus.APPROVED,
        ApplicationStatus.PAYMENT_SCHEDULED,
        ApplicationStatus.PAID,
        ApplicationStatus.REJECTED,
        ApplicationStatus.CANCELLED,
    }:
        raise DomainError(
            "CANCEL_NOT_ALLOWED",
            "此申請案已進入撥款或已結案，無法自行取消，如有需要請洽承辦人員。",
            status_code=409,
        )
    transition_application(application, ApplicationStatus.CANCELLED)
    release_claim_keys(db, application)
    record_audit(
        db,
        "APPLICATION_CANCELLED",
        ActorType.CITIZEN,
        actor_identifier or str(application.user_id),
        application=application,
    )
    db.flush()
    notify_status(db, application)
    return application


def approve_application(
    db: Session,
    application: Application,
    *,
    reviewer_identifier: str,
    reason: str,
    override_review_flag: bool = False,
) -> Application:
    """Reviewer approval. The payable amount is the rule engine's trial subsidy."""

    _validate_reason(reason)
    if application.status is not ApplicationStatus.MANUAL_REVIEW:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "This application is not awaiting a reviewer decision.",
            status_code=409,
        )

    result = evaluate_application(db, application, persist=True)
    if result is None:
        raise DomainError(
            "SOURCE_REVIEW_INCOMPLETE",
            "Required source documents have not been evaluated.",
            status_code=409,
        )
    if result.ai_result == "NEED_SUPPLEMENT":
        raise DomainError(
            "SOURCE_REVIEW_INCOMPLETE",
            "Required source documents or checks must be supplemented before approval.",
            status_code=409,
            details={
                "failed_rules": [
                    check.rule for check in result.checks if check.result == "NEED_SUPPLEMENT"
                ]
            },
        )
    review = get_review(db, application)
    amount = subsidy_amount(review.evaluation)
    if amount is None or amount <= 0:
        raise DomainError(
            "APPROVAL_BLOCKED_BY_POLICY",
            "A positive subsidy amount could not be established from the evidence.",
            status_code=409,
            details={"failed_rules": ["RULE-020"]},
        )
    flagged = [check.rule for check in result.checks if check.result]
    if flagged and not override_review_flag:
        raise DomainError(
            "REVIEW_OVERRIDE_REQUIRED",
            "The rule engine flagged this case. Confirm the override and give a reason.",
            status_code=409,
            details={"failed_rules": flagged, "ai_result": result.ai_result},
        )
    reservation_conflicts = reserve_claim_keys(db, application)
    if reservation_conflicts:
        raise DomainError(
            "CLAIM_RESERVATION_CONFLICT",
            "Another approved application already holds this receipt.",
            status_code=409,
            details={"conflicts": reservation_conflicts},
        )

    transition_application(application, ApplicationStatus.APPROVED)
    application.approved_amount_twd = amount
    application.eligibility_result = EligibilityOutcome.ELIGIBLE
    application.reviewer_reason = reason.strip()
    record_audit(
        db,
        "APPLICATION_APPROVED",
        ActorType.REVIEWER,
        reviewer_identifier,
        application=application,
        details={
            "reason": reason.strip(),
            "review_flag_overridden": bool(flagged),
            "overridden_rules": flagged,
            "ai_result": result.ai_result,
            "approved_amount_twd": application.approved_amount_twd,
        },
    )
    db.flush()
    notify_status(db, application, detail=reason.strip())
    return application


def reject_application(
    db: Session,
    application: Application,
    *,
    reviewer_identifier: str,
    reason: str,
) -> Application:
    _validate_reason(reason)
    if application.status not in {
        ApplicationStatus.MANUAL_REVIEW,
        ApplicationStatus.REQUESTED_INFORMATION,
    }:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "This application is not awaiting a reviewer decision.",
            status_code=409,
        )
    transition_application(application, ApplicationStatus.REJECTED)
    application.reviewer_reason = reason.strip()
    application.approved_amount_twd = None
    record_audit(
        db,
        "APPLICATION_REJECTED",
        ActorType.REVIEWER,
        reviewer_identifier,
        application=application,
        details={"reason": reason.strip()},
    )
    release_claim_keys(db, application)
    db.flush()
    notify_status(db, application, detail=reason.strip())
    return application


def request_more_information(
    db: Session,
    application: Application,
    *,
    reviewer_identifier: str,
    reason: str,
) -> Application:
    _validate_reason(reason)
    if application.status is not ApplicationStatus.MANUAL_REVIEW:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "More information can only be requested during manual review.",
            status_code=409,
        )
    transition_application(application, ApplicationStatus.REQUESTED_INFORMATION)
    application.information_request = reason.strip()
    record_audit(
        db,
        "MORE_INFORMATION_REQUESTED",
        ActorType.REVIEWER,
        reviewer_identifier,
        application=application,
        details={"message": reason.strip()},
    )
    db.flush()
    notify_status(db, application, detail=reason.strip())
    return application


def flag_for_further_check(
    db: Session, application: Application, *, reviewer_identifier: str, reason: str
) -> Application:
    """Mark a case for deeper checking without changing its status."""

    _validate_reason(reason)
    if application.status is not ApplicationStatus.MANUAL_REVIEW:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "Only a case in manual review can be flagged for further checks.",
            status_code=409,
        )
    application.flagged_for_check = True
    record_audit(
        db,
        "FLAGGED_FOR_FURTHER_CHECK",
        ActorType.REVIEWER,
        reviewer_identifier,
        application=application,
        details={"reason": reason.strip()},
    )
    db.flush()
    return application


def send_reviewer_message(
    db: Session, application: Application, *, reviewer_identifier: str, message: str
) -> bool:
    sent = notify_applicant(db, application, message, actor_identifier=reviewer_identifier)
    record_audit(
        db,
        "REVIEWER_MESSAGE_SENT" if sent else "REVIEWER_MESSAGE_NOT_DELIVERED",
        ActorType.REVIEWER,
        reviewer_identifier,
        application=application,
        details={"length": len(message)},
    )
    return sent


def _validate_reason(reason: str) -> None:
    if len(reason.strip()) < 3:
        raise DomainError(
            "REVIEW_REASON_REQUIRED",
            "A meaningful reviewer reason is required.",
            status_code=422,
        )
