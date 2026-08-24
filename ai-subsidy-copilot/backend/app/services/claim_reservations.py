"""Database-enforced serialization for receipt and monthly approval claims."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Application, ClaimReservation
from app.schemas.receipt import ReceiptExtraction


def reservation_keys(application: Application) -> list[str]:
    subscription = application.subscription
    if subscription is None:
        return []
    keys: list[str] = []
    if subscription.receipt_hash:
        keys.append(f"RECEIPT:{subscription.receipt_hash}")
    purchase_date = subscription.purchase_date
    if subscription.receipt_hash and subscription.extraction_json:
        try:
            purchase_date = ReceiptExtraction.model_validate(
                subscription.extraction_json
            ).purchase_date
        except (ValueError, TypeError):
            purchase_date = None
    if purchase_date:
        keys.append(f"MONTH:{application.user_id}:{purchase_date.strftime('%Y-%m')}")
    return keys


def reserve_claim_keys(db: Session, application: Application) -> list[str]:
    """Reserve unique approval keys, returning conflicts without aborting the transaction.

    PostgreSQL unique-index insertion waits for concurrent transactions and then
    deterministically rejects the loser. SQLite uses the same unique constraint,
    providing equivalent correctness for the local demo.
    """

    keys = reservation_keys(application)
    if not keys:
        return ["Claim reservation keys could not be established"]
    existing = db.scalars(
        select(ClaimReservation).where(ClaimReservation.reservation_key.in_(keys))
    ).all()
    conflicts = [row.reservation_key for row in existing if row.application_id != application.id]
    if conflicts:
        return conflicts
    missing = {row.reservation_key for row in existing}
    try:
        with db.begin_nested():
            for key in keys:
                if key not in missing:
                    db.add(ClaimReservation(reservation_key=key, application_id=application.id))
            db.flush()
    except IntegrityError:
        # A concurrent transaction won the unique key. The savepoint keeps the
        # caller's application transaction usable so it can enter manual review.
        current = db.scalars(
            select(ClaimReservation).where(ClaimReservation.reservation_key.in_(keys))
        ).all()
        conflicts = [row.reservation_key for row in current if row.application_id != application.id]
        return conflicts or keys
    return []
