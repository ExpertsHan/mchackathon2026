"""Shared domain enums persisted as stable string values."""

from enum import StrEnum


class ApplicationStatus(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    VERIFYING = "VERIFYING"
    MANUAL_REVIEW = "MANUAL_REVIEW"
    REQUESTED_INFORMATION = "REQUESTED_INFORMATION"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    PAYMENT_SCHEDULED = "PAYMENT_SCHEDULED"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class RiskLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class PaymentStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    PAID = "PAID"
    FAILED = "FAILED"


class ActorType(StrEnum):
    CITIZEN = "CITIZEN"
    AI_AGENT = "AI_AGENT"
    SYSTEM = "SYSTEM"
    RULE_ENGINE = "RULE_ENGINE"
    REVIEWER = "REVIEWER"
    PAYMENT_SERVICE = "PAYMENT_SERVICE"


class EligibilityOutcome(StrEnum):
    ELIGIBLE = "ELIGIBLE"
    PROVISIONALLY_ELIGIBLE = "PROVISIONALLY_ELIGIBLE"
    INELIGIBLE = "INELIGIBLE"
    MANUAL_REVIEW = "MANUAL_REVIEW"
