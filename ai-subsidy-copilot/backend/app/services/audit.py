"""Append-only, sanitized audit event creation."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.enums import ActorType
from app.core.errors import DomainError
from app.models import Application, AuditLog

_SENSITIVE_KEYS = {
    "api_key",
    "authorization",
    "bank_account",
    "database_url",
    "government_id",
    "openai_api_key",
    "password",
    "prompt",
    "raw_prompt",
    "receipt_storage_path",
    "secret",
    "token",
}


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if str(key).lower() in _SENSITIVE_KEYS else _json_safe(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (uuid.UUID, Decimal, Enum)):
        return str(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def record_audit(
    db: Session,
    action: str,
    actor_type: ActorType,
    actor_identifier: str,
    *,
    application: Application | None = None,
    application_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Stage an audit event in the caller's database transaction."""

    if application is not None:
        application_id = application.id
        user_id = user_id or application.user_id
    event_row = AuditLog(
        application_id=application_id,
        user_id=user_id,
        actor_type=actor_type,
        actor_identifier=actor_identifier[:160],
        action=action[:120],
        details_json=_json_safe(details or {}),
        created_at=datetime.now(UTC),
    )
    db.add(event_row)
    return event_row


@event.listens_for(AuditLog, "before_update")
def _prevent_audit_update(*_: Any) -> None:
    raise DomainError(
        "AUDIT_LOG_IMMUTABLE",
        "Audit records are append-only and cannot be changed.",
        status_code=409,
    )


@event.listens_for(AuditLog, "before_delete")
def _prevent_audit_delete(*_: Any) -> None:
    raise DomainError(
        "AUDIT_LOG_IMMUTABLE",
        "Audit records are append-only and cannot be deleted.",
        status_code=409,
    )
