"""HTTP-specific request/response contracts."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.enums import ApplicationStatus, RiskLevel
from app.schemas.domain import (
    ApplicationRead,
    AuditLogRead,
    EligibilityEvaluation,
    PaymentRead,
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
    completed_count: int
    total_count: int
    all_complete: bool
    participation_optional: bool = True
    # Kept for API compatibility with older clients. No module is required now.
    completed_required: int
    total_required: int
    all_required_complete: bool
    modules: list[SafetyProgressItem]


class SafetyEngagementEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    application_id: str | None = Field(default=None, max_length=32)
    event: Literal[
        "CHAT_REMINDER_VIEWED",
        "PRACTICE_SHOWN",
        "PRACTICE_ANSWERED",
        "PRACTICE_SKIPPED",
        "RAG_FOLLOWUP_OPENED",
    ]
    selected_option: Literal["A", "B"] | None = None

    @model_validator(mode="after")
    def validate_answer_event(self) -> SafetyEngagementEventRequest:
        if (self.event == "PRACTICE_ANSWERED") != (self.selected_option is not None):
            raise ValueError("Only PRACTICE_ANSWERED requires a selected_option.")
        return self


class CitizenAuditLogRead(BaseModel):
    id: uuid.UUID
    actor_type: str
    action: str
    details_json: dict[str, Any]
    created_at: datetime


class CitizenApplicationDetail(BaseModel):
    application: ApplicationRead
    applicant: UserRead
    eligibility: EligibilityEvaluation | None = None
    payment: PaymentRead | None = None
    citations: list[PolicyCitation] = Field(default_factory=list)
    audit_logs: list[CitizenAuditLogRead] = Field(default_factory=list)
    safety_progress: SafetyProgressResponse | None = None
    source_review: dict[str, Any] | None = None


class ApplicationDetail(BaseModel):
    application: ApplicationRead
    applicant: UserRead
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
    cancelled: int = 0
    total_approved_subsidy: Decimal
    total_paid_amount: Decimal
    # "What the AI did for the city" dashboard (ported from the OCR admin console).
    documents_uploaded: int = 0
    documents_ocr_processed: int = 0
    ocr_fields_extracted: int = 0
    applications_submitted: int = 0
    rules_total_checked: int = 0
    rules_auto_passed: int = 0
    issues_found: int = 0
    supplement_notifications_sent: int = 0
    applications_needing_human_review: int = 0
    estimated_minutes_saved: int = 0
    assumption_note: str = ""


class AdminApplicationRow(BaseModel):
    public_id: str
    applicant: str
    product: str | None
    applicant_type: str | None = None
    ai_result: str | None = None
    flagged_for_check: bool = False
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


class ApplicationStatusRead(BaseModel):
    public_id: str
    status: ApplicationStatus
    information_request: str | None = None
    estimated_subsidy_twd: Decimal | None = None
    approved_amount_twd: Decimal | None = None
    updated_at: datetime


class PaymentStatusRead(BaseModel):
    status: ApplicationStatus
    approved_amount_twd: Decimal | None = None
    bank_name: str | None = None
    bank_code: str | None = None
    account_number_last4: str | None = None
    disbursed: bool = False


class NotifyRequest(BaseModel):
    reviewer_name: str = Field(min_length=1, max_length=60)
    message: str = Field(min_length=1, max_length=1000)


class LineLinkRequest(BaseModel):
    code: str = Field(min_length=6, max_length=64)
