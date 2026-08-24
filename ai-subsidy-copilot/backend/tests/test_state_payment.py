from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session

from app.core.enums import ApplicationStatus
from app.core.errors import InvalidStateTransition, PaymentNotAllowed
from app.models import Application
from app.services.demo import DEMO_USER_IDS
from app.services.payments import process_payment, schedule_payment
from app.services.state_machine import transition_application


def application(status: ApplicationStatus, *, amount: Decimal = Decimal("550")) -> Application:
    return Application(
        public_id=f"AI-2026-{uuid4().int % 999999:06d}",
        user_id=DEMO_USER_IDS["alex"],
        status=status,
        approved_amount_twd=amount,
    )


def test_invalid_draft_to_paid_transition_is_rejected() -> None:
    draft = application(ApplicationStatus.DRAFT)
    with pytest.raises(InvalidStateTransition):
        transition_application(draft, ApplicationStatus.PAID)


def test_approved_application_can_process_payment_idempotently(db: Session) -> None:
    approved = application(ApplicationStatus.APPROVED, amount=Decimal("575"))
    db.add(approved)
    db.flush()
    first = process_payment(db, approved)
    db.commit()
    second = process_payment(db, approved)
    assert first.id == second.id
    assert first.amount_twd == Decimal("575")
    assert approved.status is ApplicationStatus.PAID
    assert first.transaction_id.startswith("GOVPAY-DEMO-")


@pytest.mark.parametrize("status", [ApplicationStatus.SUBMITTED, ApplicationStatus.REJECTED])
def test_non_approved_application_cannot_schedule_payment(
    db: Session, status: ApplicationStatus
) -> None:
    item = application(status)
    db.add(item)
    db.flush()
    with pytest.raises(PaymentNotAllowed):
        schedule_payment(db, item)


def test_payment_uses_server_approved_amount(db: Session) -> None:
    approved = application(ApplicationStatus.APPROVED, amount=Decimal("321"))
    db.add(approved)
    db.flush()
    payment = schedule_payment(db, approved)
    assert payment.amount_twd == Decimal("321")
