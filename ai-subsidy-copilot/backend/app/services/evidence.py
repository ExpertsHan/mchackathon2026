"""Application subscription and receipt evidence operations."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import ActorType, ApplicationStatus
from app.core.errors import DomainError
from app.models import Application, Subscription
from app.schemas.domain import SubscriptionInput
from app.schemas.receipt import StoredReceipt
from app.services.audit import record_audit
from app.services.receipts import ReceiptError, convert_to_twd, store_and_extract

EDITABLE_STATUSES = {ApplicationStatus.DRAFT, ApplicationStatus.REQUESTED_INFORMATION}
DUPLICATE_RELEVANT_STATUSES = {
    ApplicationStatus.SUBMITTED,
    ApplicationStatus.VERIFYING,
    ApplicationStatus.MANUAL_REVIEW,
    ApplicationStatus.APPROVED,
    ApplicationStatus.PAYMENT_SCHEDULED,
    ApplicationStatus.PAID,
}


def _ensure_editable(application: Application) -> None:
    if application.status not in EDITABLE_STATUSES:
        raise DomainError(
            "APPLICATION_NOT_EDITABLE",
            "Subscription evidence cannot be changed in the current application state.",
            status_code=409,
            details={"status": application.status.value},
        )


def set_subscription(
    db: Session,
    application: Application,
    payload: SubscriptionInput,
    *,
    actor_identifier: str,
) -> Subscription:
    _ensure_editable(application)
    subscription = application.subscription
    if subscription is None:
        subscription = Subscription(user_id=application.user_id)
        db.add(subscription)
        db.flush()
        application.subscription_id = subscription.id
        application.subscription = subscription
    supplied_fields = payload.model_dump(exclude_unset=True)
    if supplied_fields and (subscription.receipt_hash or subscription.extraction_json):
        raise DomainError(
            "RECEIPT_EVIDENCE_LOCKED",
            "Subscription evidence cannot be edited after receipt extraction. Upload a new "
            "receipt through the receipt endpoint to replace the evidence.",
            status_code=409,
        )
    for field in (
        "provider",
        "product",
        "amount",
        "currency",
        "amount_twd",
        "purchase_date",
        "receipt_reference",
        "account_email",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(subscription, field, value)
    if subscription.amount is not None and subscription.currency:
        converted = convert_to_twd(subscription.amount, subscription.currency)
        if converted is not None:
            subscription.amount_twd = converted
            application.requested_amount_twd = converted
    record_audit(
        db,
        action="SUBSCRIPTION_SELECTED",
        actor_type=ActorType.CITIZEN,
        actor_identifier=actor_identifier,
        application=application,
        user_id=application.user_id,
        details={"provider": subscription.provider, "product": subscription.product},
    )
    db.commit()
    db.refresh(subscription)
    return subscription


def receipt_duplicate_exists(
    db: Session,
    receipt_hash: str,
    *,
    exclude_application_id=None,
) -> bool:
    query = (
        select(Application.id)
        .join(Subscription, Application.subscription_id == Subscription.id)
        .where(
            Subscription.receipt_hash == receipt_hash,
            Application.status.in_(DUPLICATE_RELEVANT_STATUSES),
        )
    )
    if exclude_application_id is not None:
        query = query.where(Application.id != exclude_application_id)
    return db.scalar(query.limit(1)) is not None


def attach_receipt(
    db: Session,
    application: Application,
    *,
    filename: str,
    content_type: str | None,
    data: bytes,
    actor_identifier: str,
    storage_directory: str | Path | None = None,
) -> tuple[Subscription, StoredReceipt, bool]:
    _ensure_editable(application)
    try:
        stored = store_and_extract(
            filename=filename,
            content_type=content_type,
            data=data,
            storage_directory=storage_directory or settings.receipt_storage_dir,
        )
    except ReceiptError as exc:
        raise DomainError(exc.code, exc.message, status_code=400) from exc

    subscription = application.subscription
    if subscription is None:
        subscription = Subscription(user_id=application.user_id)
        db.add(subscription)
        db.flush()
        application.subscription_id = subscription.id
        application.subscription = subscription
    extracted = stored.extraction
    subscription.provider = extracted.provider or subscription.provider
    subscription.product = extracted.product or subscription.product
    subscription.amount = extracted.amount
    subscription.currency = extracted.currency
    subscription.purchase_date = extracted.purchase_date
    subscription.receipt_filename = stored.original_filename
    # Only the backend stores this private path. API schemas never expose it.
    subscription.receipt_storage_path = stored.storage_filename
    subscription.receipt_hash = stored.sha256
    subscription.receipt_reference = extracted.receipt_reference
    subscription.account_email = extracted.account_email
    subscription.extraction_confidence = extracted.confidence
    subscription.extraction_json = extracted.model_dump(mode="json")
    subscription.extraction_warnings_json = list(extracted.warnings)
    subscription.suspicious_content = any("Suspicious" in item for item in extracted.warnings)
    if extracted.amount is not None and extracted.currency:
        subscription.amount_twd = convert_to_twd(extracted.amount, extracted.currency)
        application.requested_amount_twd = subscription.amount_twd
        if subscription.amount_twd is None:
            subscription.extraction_warnings_json = [
                *subscription.extraction_warnings_json,
                f"No mock exchange rate is configured for {extracted.currency}.",
            ]
    duplicate = receipt_duplicate_exists(
        db,
        stored.sha256,
        exclude_application_id=application.id,
    )
    record_audit(
        db,
        action="RECEIPT_UPLOADED",
        actor_type=ActorType.CITIZEN,
        actor_identifier=actor_identifier,
        application=application,
        user_id=application.user_id,
        details={
            "filename": stored.original_filename,
            "sha256": stored.sha256,
            "size_bytes": stored.size_bytes,
            "content_type": stored.content_type,
        },
    )
    record_audit(
        db,
        action="RECEIPT_PARSED",
        actor_type=ActorType.AI_AGENT
        if extracted.extraction_method == "openai-vision"
        else ActorType.SYSTEM,
        actor_identifier=extracted.extraction_method,
        application=application,
        user_id=application.user_id,
        details={
            "method": extracted.extraction_method,
            "confidence": extracted.confidence,
            "fields_present": [
                key
                for key, value in extracted.model_dump().items()
                if key not in {"warnings", "extraction_method"} and value is not None
            ],
            "suspicious_instruction_ignored": subscription.suspicious_content,
            "duplicate_found": duplicate,
        },
    )
    db.commit()
    db.refresh(subscription)
    return subscription, stored, duplicate
