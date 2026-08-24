"""Authoritative application status transition rules."""

from __future__ import annotations

from datetime import datetime

from app.core.enums import ApplicationStatus
from app.core.errors import InvalidStateTransition
from app.models import Application, utcnow

VALID_TRANSITIONS: dict[ApplicationStatus, frozenset[ApplicationStatus]] = {
    ApplicationStatus.DRAFT: frozenset({ApplicationStatus.SUBMITTED}),
    ApplicationStatus.SUBMITTED: frozenset({ApplicationStatus.VERIFYING}),
    ApplicationStatus.VERIFYING: frozenset(
        {
            ApplicationStatus.MANUAL_REVIEW,
            ApplicationStatus.APPROVED,
            ApplicationStatus.REJECTED,
        }
    ),
    ApplicationStatus.MANUAL_REVIEW: frozenset(
        {
            ApplicationStatus.APPROVED,
            ApplicationStatus.REJECTED,
            ApplicationStatus.REQUESTED_INFORMATION,
        }
    ),
    ApplicationStatus.REQUESTED_INFORMATION: frozenset({ApplicationStatus.SUBMITTED}),
    ApplicationStatus.APPROVED: frozenset({ApplicationStatus.PAYMENT_SCHEDULED}),
    ApplicationStatus.REJECTED: frozenset(),
    ApplicationStatus.PAYMENT_SCHEDULED: frozenset({ApplicationStatus.PAID}),
    ApplicationStatus.PAID: frozenset(),
}


def can_transition(source: ApplicationStatus | str, target: ApplicationStatus | str) -> bool:
    source_status = ApplicationStatus(source)
    target_status = ApplicationStatus(target)
    return target_status in VALID_TRANSITIONS[source_status]


def transition_application(
    application: Application,
    target: ApplicationStatus | str,
    *,
    at: datetime | None = None,
) -> Application:
    """Validate and apply a state transition, including lifecycle timestamps."""

    source = ApplicationStatus(application.status)
    target_status = ApplicationStatus(target)
    if not can_transition(source, target_status):
        raise InvalidStateTransition(source.value, target_status.value)

    changed_at = at or utcnow()
    application.status = target_status
    application.updated_at = changed_at
    if target_status is ApplicationStatus.SUBMITTED and application.submitted_at is None:
        application.submitted_at = changed_at
    elif target_status is ApplicationStatus.APPROVED:
        application.approved_at = changed_at
        application.rejected_at = None
    elif target_status is ApplicationStatus.REJECTED:
        application.rejected_at = changed_at
        application.approved_at = None
    return application
