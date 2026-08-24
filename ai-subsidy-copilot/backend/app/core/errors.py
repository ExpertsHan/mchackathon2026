"""Typed operational errors translated into consistent API responses."""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            payload["details"] = self.details
        return {"error": payload}


class ResourceNotFound(DomainError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, status_code=404)


class InvalidStateTransition(DomainError):
    def __init__(self, source: str, target: str) -> None:
        super().__init__(
            "INVALID_STATE_TRANSITION",
            f"Application cannot transition from {source} to {target}.",
            status_code=409,
            details={"from": source, "to": target},
        )


class SafetyTrainingIncomplete(DomainError):
    def __init__(self) -> None:
        super().__init__(
            "SAFETY_TRAINING_INCOMPLETE",
            "Complete all required AI safety modules before submission.",
            status_code=409,
        )


class PaymentNotAllowed(DomainError):
    def __init__(self, status: str) -> None:
        super().__init__(
            "PAYMENT_NOT_ALLOWED",
            "Payment may only be processed for an approved application.",
            status_code=409,
            details={"application_status": status},
        )
