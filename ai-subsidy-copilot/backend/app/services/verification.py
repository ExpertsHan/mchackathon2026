"""Deterministic reviewer/demo verification action."""

from sqlalchemy.orm import Session

from app.core.enums import ActorType, ApplicationStatus
from app.core.errors import DomainError
from app.models import Application
from app.services.audit import record_audit
from app.services.eligibility import evaluate_application
from app.services.state_machine import transition_application


def run_verification(db: Session, application: Application) -> Application:
    if application.status not in {
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.VERIFYING,
        ApplicationStatus.MANUAL_REVIEW,
    }:
        raise DomainError(
            "INVALID_STATE_TRANSITION",
            "Verification can run only for a submitted or review-stage application.",
            status_code=409,
        )
    if application.status is ApplicationStatus.SUBMITTED:
        transition_application(application, ApplicationStatus.VERIFYING)
        record_audit(
            db,
            action="APPLICATION_VERIFICATION_STARTED",
            actor_type=ActorType.SYSTEM,
            actor_identifier="policy-workflow-v1",
            application=application,
        )

    result = evaluate_application(db, application, persist=True, reserve_claim=True)
    if application.status is ApplicationStatus.MANUAL_REVIEW:
        record_audit(
            db,
            action="MANUAL_REVIEW_RECHECKED",
            actor_type=ActorType.RULE_ENGINE,
            actor_identifier="deterministic-eligibility-v1",
            application=application,
            details={"outcome": result.outcome, "risk_level": result.risk_level},
        )
        return application

    if result.requires_manual_review:
        transition_application(application, ApplicationStatus.MANUAL_REVIEW)
        record_audit(
            db,
            action="MANUAL_REVIEW_TRIGGERED",
            actor_type=ActorType.RULE_ENGINE,
            actor_identifier="deterministic-eligibility-v1",
            application=application,
            details={"risk_level": result.risk_level, "reasons": result.risk_reasons},
        )
    elif result.eligible:
        transition_application(application, ApplicationStatus.APPROVED)
        application.approved_amount_twd = result.approved_amount_twd
        record_audit(
            db,
            action="APPLICATION_APPROVED",
            actor_type=ActorType.RULE_ENGINE,
            actor_identifier="deterministic-policy-workflow-v1",
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
            action="APPLICATION_REJECTED",
            actor_type=ActorType.RULE_ENGINE,
            actor_identifier="deterministic-policy-workflow-v1",
            application=application,
            details={
                "failed_rules": [check.rule.value for check in result.checks if not check.passed]
            },
        )
    return application
