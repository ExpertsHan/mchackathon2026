"""Only applicant declarations are accepted from clients; OCR is server-owned."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DocumentType = Literal[
    "receipt", "id_card", "passbook", "declaration", "cultural_proof", "payer_declaration"
]


class SourceApplicantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    birth_date: date | None = None
    household_address: str | None = Field(default=None, max_length=300)
    applicant_type: Literal["normal", "special", "language"] = "normal"
    payment_type: Literal["monthly", "annual"] = "monthly"
    software_category: Literal["general", "image", "office", "learning", "other"] = "general"
    purchase_date: date | None = None
    declared_amount: float | None = Field(default=None, gt=0, le=1_000_000, allow_inf_nan=False)
    is_own_credit_card: bool = True
