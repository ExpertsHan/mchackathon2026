"""Database-enforced serialization for receipt claims across approved applications."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Application, ClaimReservation, SourceDocument


def reservation_keys(db: Session, application: Application) -> list[str]:
    """One key per distinct receipt file (and per issuer reference) in the application."""

    receipts = db.scalars(
        select(SourceDocument).where(
            SourceDocument.application_id == application.id,
            SourceDocument.document_type == "receipt",
            SourceDocument.active.is_(True),
        )
    ).all()
    keys: list[str] = []
    for receipt in receipts:
        keys.append(f"RECEIPT:{receipt.sha256}")
        reference = receipt.ocr_data.get("receipt_reference")
        company = receipt.ocr_data.get("company_name")
        if reference and company:
            keys.append(f"REF:{company.casefold()}:{reference.casefold()}")
    return sorted(set(keys))


def reserve_claim_keys(db: Session, application: Application) -> list[str]:
    """Reserve unique approval keys, returning conflicts without aborting the transaction.

    PostgreSQL unique-index insertion waits for concurrent transactions and then
    deterministically rejects the loser. SQLite uses the same unique constraint,
    providing equivalent correctness for the local demo.
    """

    keys = reservation_keys(db, application)
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
        # caller's application transaction usable so the reviewer can be told.
        current = db.scalars(
            select(ClaimReservation).where(ClaimReservation.reservation_key.in_(keys))
        ).all()
        conflicts = [row.reservation_key for row in current if row.application_id != application.id]
        return conflicts or keys
    return []


def release_claim_keys(db: Session, application: Application) -> None:
    for row in db.scalars(
        select(ClaimReservation).where(ClaimReservation.application_id == application.id)
    ).all():
        db.delete(row)
