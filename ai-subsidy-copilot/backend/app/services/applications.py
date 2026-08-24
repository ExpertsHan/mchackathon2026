"""Application lifecycle services used by citizen and reviewer APIs."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.enums import ActorType, ApplicationStatus, EligibilityOutcome
from app.core.errors import DomainError, ResourceNotFound, SafetyTrainingIncomplete
from app.models import Application, ApplicationIdSequence, Subscription, User
from app.schemas import EligibilityEvaluation, SubscriptionInput
from app.services.audit import record_audit
from app.services.claim_reservations import reserve_claim_keys
from app.services.eligibility import convert_to_twd, evaluate_application
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


def set_subscription(
    db: Session,
    application: Application,
    data: SubscriptionInput,
    *,
    actor_identifier: str | None = None,
) -> Subscription:
    if application.status not in {
        ApplicationStatus.DRAFT,
        ApplicationStatus.REQUESTED_INFORMATION,
    }:
        raise DomainError(
            "APPLICATION_NOT_EDITABLE",
            "Subscription information cannot be changed in the current state.",
            status_code=409,
        )

    subscription = application.subscription
    if subscription is None:
        subscription = Subscription(user_id=application.user_id)
        db.add(subscription)
        db.flush()
        application.subscription_id = subscription.id
        application.subscription = subscription

    values = data.model_dump(exclude_unset=True)
    if values and (subscription.receipt_hash or subscription.extraction_json):
        raise DomainError(
            "RECEIPT_EVIDENCE_LOCKED",
            "Subscription evidence cannot be edited after receipt extraction. Upload a new "
            "receipt through the receipt endpoint to replace the evidence.",
            status_code=409,
        )
    if values.get("amount_twd") is None and values.get("amount") and values.get("currency"):
        try:
            values["amount_twd"] = convert_to_twd(values["amount"], values["currency"])
        except ValueError as exc:
            raise DomainError(
                "UNSUPPORTED_CURRENCY",
                str(exc),
                status_code=422,
            ) from exc
    for key, value in values.items():
        setattr(subscription, key, value)
    db.flush()
    record_audit(
        db,
        "SUBSCRIPTION_SELECTED",
        ActorType.CITIZEN,
        actor_identifier or str(application.user_id),
        application=application,
        details={
            "provider": subscription.provider,
            "product": subscription.product,
            "amount": subscription.amount,
            "currency": subscription.currency,
            "mock_amount_twd": subscription.amount_twd,
        },
    )
    return subscription


def submit_application(
    db: Session,
    application: Application,
    *,
    actor_identifier: str | None = None,
) -> Application:
    if application.status not in {
        ApplicationStatus.DRAFT,
        ApplicationStatus.REQUESTED_INFORMATION,
    }:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "Only a draft or information-requested application can be submitted.",
            status_code=409,
        )
    if application.subscription is None:
        raise DomainError(
            "MISSING_SUBSCRIPTION",
            "Add subscription and receipt information before submission.",
            status_code=409,
        )

    result = evaluate_application(db, application, persist=True, reserve_claim=True)
    safety_check = next(
        check for check in result.checks if check.rule.value == "SAFETY_TRAINING_COMPLETED"
    )
    if not safety_check.passed:
        raise SafetyTrainingIncomplete()

    transition_application(application, ApplicationStatus.SUBMITTED)
    application.information_request = None
    record_audit(
        db,
        "APPLICATION_SUBMITTED",
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

    if result.requires_manual_review:
        transition_application(application, ApplicationStatus.MANUAL_REVIEW)
        record_audit(
            db,
            "MANUAL_REVIEW_TRIGGERED",
            ActorType.RULE_ENGINE,
            "deterministic-eligibility-v1",
            application=application,
            details={"risk_level": result.risk_level, "reasons": result.risk_reasons},
        )
    elif result.eligible:
        transition_application(application, ApplicationStatus.APPROVED)
        application.approved_amount_twd = result.approved_amount_twd
        record_audit(
            db,
            "APPLICATION_APPROVED",
            ActorType.RULE_ENGINE,
            "deterministic-policy-workflow-v1",
            application=application,
            details={
                "decision_authority": "RULE_ENGINE",
                "approved_amount_twd": result.approved_amount_twd,
            },
        )
    else:
        transition_application(application, ApplicationStatus.REJECTED)
        record_audit(
            db,
            "APPLICATION_REJECTED",
            ActorType.RULE_ENGINE,
            "deterministic-policy-workflow-v1",
            application=application,
            details={"failed_rules": _failed_rules(result)},
        )
    db.flush()
    return application


def approve_application(
    db: Session,
    application: Application,
    *,
    reviewer_identifier: str,
    reason: str,
    override_review_flag: bool = False,
) -> Application:
    _validate_reason(reason)
    if application.status not in {
        ApplicationStatus.MANUAL_REVIEW,
        ApplicationStatus.VERIFYING,
    }:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "This application is not awaiting a reviewer decision.",
            status_code=409,
        )

    result = evaluate_application(db, application, persist=True)
    safety_check = next(
        check for check in result.checks if check.rule.value == "SAFETY_TRAINING_COMPLETED"
    )
    if not safety_check.passed:
        raise SafetyTrainingIncomplete()

    blocking_failures = [
        check.rule.value for check in result.checks if not check.passed and check.blocking
    ]
    if result.estimated_amount_twd <= 0:
        blocking_failures.append("VALID_RECEIPT_AMOUNT")
    if blocking_failures:
        raise DomainError(
            "APPROVAL_BLOCKED_BY_POLICY",
            "Reviewer approval cannot override a failed mandatory policy rule.",
            status_code=409,
            details={"failed_rules": blocking_failures},
        )
    if not result.eligible and not override_review_flag:
        raise DomainError(
            "REVIEW_OVERRIDE_REQUIRED",
            "Confirm the evidence-based review override and provide a reason.",
            status_code=409,
        )
    reservation_conflicts = reserve_claim_keys(db, application)
    if reservation_conflicts:
        raise DomainError(
            "CLAIM_RESERVATION_CONFLICT",
            "Another approved application already holds this receipt or monthly claim.",
            status_code=409,
            details={"conflicts": reservation_conflicts},
        )

    transition_application(application, ApplicationStatus.APPROVED)
    application.approved_amount_twd = result.estimated_amount_twd
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
            "review_flag_overridden": not result.eligible,
            "previous_outcome": result.outcome,
            "approved_amount_twd": application.approved_amount_twd,
        },
    )
    db.flush()
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
        ApplicationStatus.VERIFYING,
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
    db.flush()
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
    return application


def _validate_reason(reason: str) -> None:
    if len(reason.strip()) < 3:
        raise DomainError(
            "REVIEW_REASON_REQUIRED",
            "A meaningful reviewer reason is required.",
            status_code=422,
        )


def _failed_rules(result: EligibilityEvaluation) -> list[str]:
    return [check.rule.value for check in result.checks if not check.passed]
