"""Applicant declarations accepted from clients; OCR output is server-owned."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.identity import is_valid_government_id, normalize_government_id

DocumentType = Literal[
    "receipt", "id_card", "passbook", "declaration", "cultural_proof", "payer_declaration"
]
Currency = Literal["TWD", "USD", "JPY", "EUR", "AUD", "HKD", "other"]


class SourceApplicantInput(BaseModel):
    """The applicant form. Name and email come from the authenticated profile."""

    model_config = ConfigDict(extra="forbid")

    # Write-only: hashed for the one-active-application check and never stored.
    id_number: str | None = Field(default=None, max_length=12)
    phone: str | None = Field(default=None, max_length=30)
    birth_date: date | None = None
    household_address: str | None = Field(default=None, max_length=300)
    mailing_address: str | None = Field(default=None, max_length=300)
    applicant_type: Literal["normal", "special", "language"] = "normal"
    applicant_subtype: str | None = Field(default=None, max_length=80)
    payment_type: Literal["monthly", "annual"] = "monthly"
    software_category: Literal["general", "image", "office", "learning", "other"] = "general"
    applied_tool_name: str | None = Field(default=None, max_length=120)
    software_company: str | None = Field(default=None, max_length=120)
    purchase_date: date | None = None
    is_own_credit_card: bool = True
    original_currency: Currency | None = None
    original_amount: float | None = Field(default=None, gt=0, le=1_000_000, allow_inf_nan=False)
    # NT$ amount the applicant converted; cross-checked against the receipt OCR.
    declared_amount: float | None = Field(default=None, gt=0, le=1_000_000, allow_inf_nan=False)

    @field_validator("id_number")
    @classmethod
    def valid_id_number(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        if not is_valid_government_id(value):
            raise ValueError("身分證字號格式不正確。")
        return normalize_government_id(value)
