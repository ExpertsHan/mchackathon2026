from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class AgentIntent(StrEnum):
    FAQ = "FAQ"
    APPLICATION_GUIDANCE = "APPLICATION_GUIDANCE"
    ELIGIBILITY = "ELIGIBILITY"
    STATUS_LOOKUP = "STATUS_LOOKUP"
    SUBMIT = "SUBMIT"


class WorkflowStage(StrEnum):
    CHECK_IDENTITY = "CHECK_IDENTITY"
    COLLECT_SUBSCRIPTION = "COLLECT_SUBSCRIPTION"
    COLLECT_RECEIPT = "COLLECT_RECEIPT"
    CHECK_ELIGIBILITY = "CHECK_ELIGIBILITY"
    SAFETY_TRAINING = "SAFETY_TRAINING"
    FINAL_REVIEW = "FINAL_REVIEW"
    SUBMITTED = "SUBMITTED"
    MANUAL_REVIEW_REQUIRED = "MANUAL_REVIEW_REQUIRED"
    END = "END"


class AgentState(BaseModel):
    user_id: uuid.UUID
    application_id: str | None = None
    intent: AgentIntent = AgentIntent.APPLICATION_GUIDANCE
    stage: WorkflowStage = WorkflowStage.CHECK_IDENTITY
    identity_verified: bool = False
    provider: str | None = None
    product: str | None = None
    receipt_id: str | None = None
    receipt_extracted: dict[str, Any] = Field(default_factory=dict)
    policy_context: list[dict[str, Any]] = Field(default_factory=list)
    eligibility_result: dict[str, Any] = Field(default_factory=dict)
    safety_complete: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    status: str = "DRAFT"


class PersistedAgentState(BaseModel):
    """Minimal, non-authoritative state retained for demo conversation continuity."""

    intent: AgentIntent
    stage: WorkflowStage
    provider: str | None = None
    product: str | None = None
    receipt_uploaded: bool = False
    safety_complete: bool = False
    missing_fields: list[str] = Field(default_factory=list)
    status: str = "DRAFT"
