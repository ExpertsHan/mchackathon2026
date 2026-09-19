"""Reviewer-triggered re-verification. It refreshes the rule-engine verdict only."""

from sqlalchemy.orm import Session

from app.core.enums import ActorType, ApplicationStatus
from app.core.errors import DomainError
from app.models import Application
from app.services.audit import record_audit
from app.services.eligibility import evaluate_application
from app.services.source_review import request_source_supplements
from app.services.state_machine import transition_application


def run_verification(
    db: Session, application: Application, *, reviewer_identifier: str = "system"
) -> Application:
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

    result = evaluate_application(db, application, persist=True)
    if result is None:
        raise DomainError(
            "SOURCE_REVIEW_INCOMPLETE",
            "The application has no evaluated source documents.",
            status_code=409,
        )
    if application.status is ApplicationStatus.MANUAL_REVIEW:
        record_audit(
            db,
            action="MANUAL_REVIEW_RECHECKED",
            actor_type=ActorType.REVIEWER,
            actor_identifier=reviewer_identifier,
            application=application,
            details={"ai_result": result.ai_result, "risk_level": result.risk_level},
        )
        return application

    transition_application(application, ApplicationStatus.MANUAL_REVIEW)
    record_audit(
        db,
        action="MANUAL_REVIEW_TRIGGERED",
        actor_type=ActorType.RULE_ENGINE,
        actor_identifier="ocr-rules-v1",
        application=application,
        details={"ai_result": result.ai_result, "risk_level": result.risk_level},
    )
    request_source_supplements(db, application)
    return application
