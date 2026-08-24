"""Typed request, response, and rule-engine contracts."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.enums import (
    ActorType,
    ApplicationStatus,
    EligibilityOutcome,
    EligibilityRule,
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


class SubscriptionInput(BaseModel):
    provider: str | None = Field(default=None, max_length=120)
    product: str | None = Field(default=None, max_length=120)
    amount: Decimal | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    amount_twd: Decimal | None = Field(default=None, gt=0)
    purchase_date: date | None = None
    receipt_reference: str | None = Field(default=None, max_length=160)
    account_email: str | None = Field(default=None, max_length=255)

    @field_validator("currency")
    @classmethod
    def uppercase_currency(cls, value: str | None) -> str | None:
        return value.upper() if value else value


class SubscriptionRead(ORMModel):
    id: uuid.UUID
    provider: str | None
    product: str | None
    amount: Decimal | None
    currency: str | None
    amount_twd: Decimal | None
    purchase_date: date | None
    receipt_filename: str | None
    receipt_hash: str | None
    receipt_reference: str | None
    account_email: str | None
    extraction_confidence: float | None
    extraction_json: dict[str, Any]
    extraction_warnings_json: list[str]
    suspicious_content: bool
    created_at: datetime


class EligibilityCheck(BaseModel):
    rule: EligibilityRule
    passed: bool
    message: str
    blocking: bool = False
    requires_manual_review: bool = False


class RiskAssessment(BaseModel):
    level: RiskLevel
    reasons: list[str] = Field(default_factory=list)
    requires_manual_review: bool = False


class EligibilityInput(BaseModel):
    age: int | None
    identity_verified: bool
    provider: str | None
    product: str | None
    purchase_date: date | None
    receipt_hash: str | None
    user_id: uuid.UUID | None = None
    amount_twd: Decimal | None
    safety_complete: bool
    duplicate_receipt: bool = False
    monthly_claim_exists: bool = False
    extraction_confidence: float | None = Field(default=1.0, ge=0, le=1)
    extraction_method: str | None = None
    inconsistent_fields: list[str] = Field(default_factory=list)
    suspicious_receipt: bool = False
    policy_established: bool = True
    claim_reservation_conflicts: list[str] = Field(default_factory=list)


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
    mock_exchange_rate_notice: str = "Mock exchange rates are used for demonstration."


class ApplicationRead(ORMModel):
    id: uuid.UUID
    public_id: str
    user_id: uuid.UUID
    subscription_id: uuid.UUID | None
    requested_amount_twd: Decimal | None
    approved_amount_twd: Decimal | None
    eligibility_result: EligibilityOutcome | None
    eligibility_reasons_json: list[dict[str, Any]]
    policy_citations_json: list[dict[str, Any]]
    risk_level: RiskLevel
    risk_reasons_json: list[str]
    status: ApplicationStatus
    reviewer_reason: str | None
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
    reason: str = Field(min_length=3, max_length=2000)
    override_review_flag: bool = False


class SafetyAnswerRequest(BaseModel):
    user_id: uuid.UUID
    answer: str = Field(min_length=1, max_length=20)


class SafetyAnswerResult(BaseModel):
    correct: bool
    completed: bool
    score: int
    attempts: int
    explanation: str
