"""Typed request, response, and rule-engine contracts."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import (
    ActorType,
    ApplicationStatus,
    EligibilityOutcome,
    PaymentStatus,
    RiskLevel,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserRead(ORMModel):
    id: uuid.UUID
    name: str
    government_id_masked: str
    age: int
    email: str
    identity_verified: bool
    created_at: datetime


class DemoLoginRequest(BaseModel):
    user_id: uuid.UUID


class ApplicationCreate(BaseModel):
    user_id: uuid.UUID


class EligibilityCheck(BaseModel):
    """One RULE-0xx verdict from the OCR rule engine."""

    rule: str
    name: str | None = None
    passed: bool
    message: str
    blocking: bool = False
    requires_manual_review: bool = False
    # Raw engine disposition: NEED_SUPPLEMENT / REVIEW / REJECT / FRAUD_RISK, or None if passed.
    result: str | None = None


class EligibilityEvaluation(BaseModel):
    eligible: bool
    provisionally_eligible: bool = False
    requires_manual_review: bool
    outcome: EligibilityOutcome
    approved_amount_twd: Decimal
    estimated_amount_twd: Decimal
    checks: list[EligibilityCheck]
    risk_level: RiskLevel
    risk_reasons: list[str] = Field(default_factory=list)
    # PASS / REVIEW / NEED_SUPPLEMENT / REJECT / FRAUD_RISK as returned by the rule engine.
    ai_result: str | None = None


class ApplicationRead(ORMModel):
    id: uuid.UUID
    public_id: str
    user_id: uuid.UUID
    requested_amount_twd: Decimal | None
    approved_amount_twd: Decimal | None
    eligibility_result: EligibilityOutcome | None
    eligibility_reasons_json: list[dict[str, Any]]
    policy_citations_json: list[dict[str, Any]]
    risk_level: RiskLevel
    risk_reasons_json: list[str]
    status: ApplicationStatus
    reviewer_reason: str | None
    flagged_for_check: bool = False
    information_request: str | None
    submitted_at: datetime | None
    approved_at: datetime | None
    rejected_at: datetime | None
    created_at: datetime
    updated_at: datetime


class PaymentRead(ORMModel):
    id: uuid.UUID
    application_id: uuid.UUID
    amount_twd: Decimal
    status: PaymentStatus
    transaction_id: str | None
    scheduled_at: datetime | None
    paid_at: datetime | None


class AuditLogRead(ORMModel):
    id: uuid.UUID
    application_id: uuid.UUID | None
    user_id: uuid.UUID | None
    actor_type: ActorType
    actor_identifier: str
    action: str
    details_json: dict[str, Any]
    created_at: datetime


class ReviewerActionRequest(BaseModel):
    # Lightweight named sign-off: recorded as the audit actor. Not authentication.
    reviewer_name: str = Field(min_length=1, max_length=60)
    reason: str = Field(min_length=3, max_length=2000)
    override_review_flag: bool = False


class ReviewerIdentityRequest(BaseModel):
    reviewer_name: str = Field(min_length=1, max_length=60)


class SafetyAnswerRequest(BaseModel):
    user_id: uuid.UUID
    answer: str = Field(min_length=1, max_length=20)


class SafetyAnswerResult(BaseModel):
    correct: bool
    completed: bool
    score: int
    attempts: int
    explanation: str
