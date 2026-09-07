"""Narrow, server-owned tools available to the controlled assistant.

There is intentionally no approval, override, policy-editing, or payment tool here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ResourceNotFound
from app.models import Application, User
from app.rag.retrieval import answer_policy_question
from app.rag.retrieval import search_policy as retrieve_policy_chunks
from app.services.eligibility import evaluate_application
from app.services.safety import get_safety_progress

ELIGIBLE_PRODUCTS = ["ChatGPT Plus", "Claude Pro", "Notion AI"]


def search_policy(db: Session, query: str):
    return answer_policy_question(db, query)


def search_policy_evidence(db: Session, query: str, *, top_k: int = 4) -> dict[str, object]:
    """Return compact raw evidence for the model without a nested generation call."""

    results = retrieve_policy_chunks(db, query, top_k=top_k)
    return {
        "established": bool(results),
        "results": [
            {
                "content": item.content[:1600],
                "score": item.score,
                "citation": item.citation.model_dump(mode="json"),
                "effective_from": (
                    item.effective_from.isoformat() if item.effective_from is not None else None
                ),
                "effective_to": (
                    item.effective_to.isoformat() if item.effective_to is not None else None
                ),
            }
            for item in results
        ],
    }


def get_eligible_products() -> list[str]:
    return list(ELIGIBLE_PRODUCTS)


def get_current_program_rules() -> dict[str, object]:
    return {
        "period": {"from": "2026-01-01", "to": "2026-12-31"},
        "minimum_age": 18,
        "maximum_reimbursement_twd": 600,
        "claims_per_calendar_month": 1,
        "safety_training_required": True,
        "exchange_rates": {"TWD": 1, "USD": 30, "EUR": 32},
        "exchange_rate_notice": "Mock exchange rates used for demonstration.",
    }


def get_user_profile(db: Session, user_id: uuid.UUID) -> dict[str, object]:
    user = db.get(User, user_id)
    if user is None:
        raise ResourceNotFound("USER_NOT_FOUND", "Demo user was not found.")
    return {
        "id": str(user.id),
        "name": user.name,
        "government_id_masked": user.government_id_masked,
        "age": user.age,
        "identity_verified": user.identity_verified,
    }


def get_application(db: Session, public_id: str, user_id: uuid.UUID) -> Application:
    application = db.scalar(
        select(Application).where(
            Application.public_id == public_id,
            Application.user_id == user_id,
        )
    )
    if application is None:
        raise ResourceNotFound("APPLICATION_NOT_FOUND", "Application was not found.")
    return application


def get_application_status(db: Session, public_id: str, user_id: uuid.UUID) -> dict[str, object]:
    application = get_application(db, public_id, user_id)
    payment = application.payment
    return {
        "public_id": application.public_id,
        "status": application.status.value,
        "approved_amount_twd": application.approved_amount_twd,
        "payment_status": payment.status.value if payment else None,
        "transaction_id": payment.transaction_id if payment else None,
    }


def run_eligibility(db: Session, public_id: str, user_id: uuid.UUID):
    application = get_application(db, public_id, user_id)
    return evaluate_application(db, application, persist=True)


def safety_progress(db: Session, user_id: uuid.UUID):
    return get_safety_progress(db, user_id)


def get_application_progress(
    db: Session, public_id: str | None, user_id: uuid.UUID
) -> dict[str, object]:
    """Return an owner-scoped, non-sensitive snapshot for the read-only agent tool."""

    progress = safety_progress(db, user_id)
    if not public_id:
        return {
            "application_selected": False,
            "status": None,
            "missing_fields": ["application"],
            "safety_complete": progress.all_required_complete,
        }
    application = get_application(db, public_id, user_id)
    subscription = application.subscription
    missing_fields: list[str] = []
    if subscription is None or not subscription.product:
        missing_fields.append("subscription product")
    if subscription is None or not subscription.receipt_hash:
        missing_fields.append("receipt")
    if not progress.all_required_complete:
        missing_fields.append("AI safety training")
    return {
        "application_selected": True,
        "public_id": application.public_id,
        "status": application.status.value,
        "provider": subscription.provider if subscription else None,
        "product": subscription.product if subscription else None,
        "receipt_uploaded": bool(subscription and subscription.receipt_hash),
        "eligibility_checked": application.eligibility_result is not None,
        "safety_complete": progress.all_required_complete,
        "missing_fields": missing_fields,
    }
