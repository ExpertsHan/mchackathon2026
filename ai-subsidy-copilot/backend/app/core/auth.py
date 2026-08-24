"""Lightweight signed demo identity tokens and citizen ownership checks.

This is deliberately not production IAM. It prevents one selected demo citizen
from reading or mutating another citizen's records while keeping login frictionless.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.errors import DomainError
from app.models import Application, User


def _signature(user_id: uuid.UUID) -> str:
    return hmac.new(
        settings.demo_auth_secret.encode(),
        str(user_id).encode(),
        hashlib.sha256,
    ).hexdigest()


def issue_demo_token(user_id: uuid.UUID) -> str:
    return f"demo.{user_id}.{_signature(user_id)}"


def _token_user_id(token: str) -> uuid.UUID | None:
    try:
        prefix, raw_user_id, provided_signature = token.split(".", 2)
        user_id = uuid.UUID(raw_user_id)
    except (ValueError, AttributeError):
        return None
    if prefix != "demo" or not hmac.compare_digest(provided_signature, _signature(user_id)):
        return None
    return user_id


def get_current_demo_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise DomainError(
            "AUTH_REQUIRED",
            "Select a demo applicant and provide its Bearer token.",
            status_code=401,
        )
    user_id = _token_user_id(authorization.removeprefix("Bearer ").strip())
    user = db.get(User, user_id) if user_id else None
    if user is None:
        raise DomainError(
            "INVALID_DEMO_TOKEN",
            "The demo identity token is invalid.",
            status_code=401,
        )
    return user


def require_user(current_user: User, requested_user_id: uuid.UUID) -> None:
    if current_user.id != requested_user_id:
        raise DomainError(
            "FORBIDDEN",
            "This demo identity cannot access another citizen's data.",
            status_code=403,
        )


def require_application_owner(current_user: User, application: Application) -> None:
    require_user(current_user, application.user_id)
