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
from app.services.eligibility import evaluate_application
from app.services.safety import get_safety_progress

ELIGIBLE_PRODUCTS = ["ChatGPT Plus", "Claude Pro", "Notion AI"]


def search_policy(db: Session, query: str):
    return answer_policy_question(db, query)


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
