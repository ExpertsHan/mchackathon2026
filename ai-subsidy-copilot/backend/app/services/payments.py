"""Mock treasury with server-side authorization and idempotency."""

from __future__ import annotations

import secrets
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.enums import ActorType, ApplicationStatus, PaymentStatus
from app.core.errors import DomainError, PaymentNotAllowed
from app.models import Application, Payment, utcnow
from app.services.audit import record_audit
from app.services.state_machine import transition_application


def schedule_payment(
    db: Session,
    application: Application,
    *,
    actor_identifier: str = "mock-treasury-v1",
) -> Payment:
    """Schedule one payment, always using the persisted approved amount."""

    if application.payment is not None:
        if application.status in {
            ApplicationStatus.PAYMENT_SCHEDULED,
            ApplicationStatus.PAID,
        }:
            return application.payment
        raise DomainError(
            "PAYMENT_STATE_INCONSISTENT",
            "A payment record already exists for this application.",
            status_code=409,
        )
    if application.status is not ApplicationStatus.APPROVED:
        raise PaymentNotAllowed(application.status.value)
    if application.approved_amount_twd is None or application.approved_amount_twd <= 0:
        raise DomainError(
            "PAYMENT_NOT_ALLOWED",
            "The application has no positive approved subsidy amount.",
            status_code=409,
        )

    now = utcnow()
    payment = Payment(
        application_id=application.id,
        amount_twd=Decimal(application.approved_amount_twd),
        status=PaymentStatus.SCHEDULED,
        scheduled_at=now,
    )
    db.add(payment)
    application.payment = payment
    transition_application(application, ApplicationStatus.PAYMENT_SCHEDULED, at=now)
    record_audit(
        db,
        "PAYMENT_SCHEDULED",
        ActorType.PAYMENT_SERVICE,
        actor_identifier,
        application=application,
        details={"amount_twd": payment.amount_twd, "mock_payment": True},
    )
    db.flush()
    return payment


def complete_payment(
    db: Session,
    application: Application,
    *,
    actor_identifier: str = "mock-treasury-v1",
) -> Payment:
    """Complete a scheduled mock payment and mint a non-financial demo ID."""

    if application.status is ApplicationStatus.PAID and application.payment is not None:
        return application.payment
    if application.status is not ApplicationStatus.PAYMENT_SCHEDULED:
        raise PaymentNotAllowed(application.status.value)
    payment = application.payment
    if payment is None or payment.status is not PaymentStatus.SCHEDULED:
        raise DomainError(
            "PAYMENT_STATE_INCONSISTENT",
            "The scheduled payment record is missing or invalid.",
            status_code=409,
        )

    now = utcnow()
    payment.status = PaymentStatus.PAID
    payment.transaction_id = f"GOVPAY-DEMO-{secrets.token_hex(4).upper()}"
    payment.paid_at = now
    payment.updated_at = now
    transition_application(application, ApplicationStatus.PAID, at=now)
    record_audit(
        db,
        "PAYMENT_COMPLETED",
        ActorType.PAYMENT_SERVICE,
        actor_identifier,
        application=application,
        details={
            "amount_twd": payment.amount_twd,
            "transaction_id": payment.transaction_id,
            "mock_payment": True,
        },
    )
    db.flush()
    return payment


def process_payment(
    db: Session,
    application: Application,
    *,
    actor_identifier: str = "mock-treasury-v1",
) -> Payment:
    """Demo convenience action: schedule then complete, idempotently."""

    if application.status is ApplicationStatus.PAID and application.payment is not None:
        return application.payment
    if application.status is ApplicationStatus.APPROVED:
        schedule_payment(db, application, actor_identifier=actor_identifier)
    return complete_payment(db, application, actor_identifier=actor_identifier)
