"""HTTP-specific request/response contracts."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import ApplicationStatus, RiskLevel
from app.schemas.domain import (
    ApplicationRead,
    AuditLogRead,
    EligibilityEvaluation,
    PaymentRead,
    SubscriptionRead,
    UserRead,
)
from app.schemas.policy import PolicyCitation


class DemoLoginResponse(BaseModel):
    user: UserRead
    demo_token: str
    notice: str = "Demo identity only — no real government authentication was performed."


class SafetyModuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    title: str
    content: str
    required: bool
    order_index: int
    question: str
    choices: list[dict[str, str]]


class SafetyProgressItem(BaseModel):
    module_id: uuid.UUID
    slug: str
    title: str
    required: bool
    completed: bool
    score: int
    attempts: int
    completed_at: datetime | None


class SafetyProgressResponse(BaseModel):
    user_id: uuid.UUID
    completed_required: int
    total_required: int
    all_required_complete: bool
    modules: list[SafetyProgressItem]


class CitizenSubscriptionRead(BaseModel):
    """Receipt view safe for the owning citizen portal.

    Hashes, account emails, extraction payloads, and private storage paths are
    reviewer evidence and are intentionally absent.
    """

    id: uuid.UUID
    provider: str | None
    product: str | None
    amount: Decimal | None
    currency: str | None
    amount_twd: Decimal | None
    purchase_date: date | None
    receipt_filename: str | None
    receipt_reference: str | None
    extraction_confidence: float | None
    extraction_warnings_json: list[str]
    suspicious_content: bool
    receipt_uploaded: bool
    created_at: datetime


class ReceiptUploadResponse(BaseModel):
    subscription: CitizenSubscriptionRead
    duplicate_receipt: bool
    mock_exchange_rate: str | None = None
    requires_manual_review: bool


class CitizenAuditLogRead(BaseModel):
    id: uuid.UUID
    actor_type: str
    action: str
    details_json: dict[str, Any]
    created_at: datetime


class CitizenApplicationDetail(BaseModel):
    application: ApplicationRead
    applicant: UserRead
    subscription: CitizenSubscriptionRead | None = None
    eligibility: EligibilityEvaluation | None = None
    payment: PaymentRead | None = None
    citations: list[PolicyCitation] = Field(default_factory=list)
    audit_logs: list[CitizenAuditLogRead] = Field(default_factory=list)
    safety_progress: SafetyProgressResponse | None = None
    source_review: dict[str, Any] | None = None


class ApplicationDetail(BaseModel):
    application: ApplicationRead
    applicant: UserRead
    subscription: SubscriptionRead | None = None
    eligibility: EligibilityEvaluation | None = None
    payment: PaymentRead | None = None
    citations: list[PolicyCitation] = Field(default_factory=list)
    audit_logs: list[AuditLogRead] = Field(default_factory=list)
    safety_progress: SafetyProgressResponse | None = None
    source_review: dict[str, Any] | None = None


class TimelineEvent(BaseModel):
    action: str
    label: str
    timestamp: datetime
    actor_type: str
    details: dict[str, Any] = Field(default_factory=dict)


class TimelineResponse(BaseModel):
    public_id: str
    status: ApplicationStatus
    events: list[TimelineEvent]
    payment: PaymentRead | None = None


class AdminStats(BaseModel):
    total_applications: int
    draft: int
    submitted: int
    verifying: int
    manual_review: int
    requested_information: int
    approved: int
    rejected: int
    payment_scheduled: int
    paid: int
    total_approved_subsidy: Decimal
    total_paid_amount: Decimal


class AdminApplicationRow(BaseModel):
    public_id: str
    applicant: str
    product: str | None
    requested_amount_twd: Decimal | None
    approved_amount_twd: Decimal | None
    risk_level: RiskLevel
    status: ApplicationStatus
    submitted_at: datetime | None
    created_at: datetime


class AdminApplicationsResponse(BaseModel):
    items: list[AdminApplicationRow]
    total: int


class AgentChatRequest(BaseModel):
    user_id: uuid.UUID
    application_id: str | None = Field(default=None, max_length=32)
    message: str = Field(min_length=1, max_length=2000)


class SuggestedAction(BaseModel):
    type: str
    label: str
    href: str | None = None
    value: str | None = None


class AgentChatResponse(BaseModel):
    message: str
    citations: list[PolicyCitation] = Field(default_factory=list)
    suggested_actions: list[SuggestedAction] = Field(default_factory=list)
    agent_state: dict[str, Any] = Field(default_factory=dict)
    ai_used: bool = False
    notice: str | None = None


class AgentHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AgentHistoryResponse(BaseModel):
    messages: list[AgentHistoryMessage] = Field(default_factory=list)


class MessageResponse(BaseModel):
    message: str
