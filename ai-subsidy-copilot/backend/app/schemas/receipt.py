"""Typed receipt extraction payloads.

Receipt contents are untrusted evidence.  These models intentionally contain data
only; no receipt field is ever interpreted as an instruction or workflow action.
"""

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ReceiptExtraction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    provider: str | None = None
    product: str | None = None
    amount: Decimal | None = Field(default=None, ge=0, le=1_000_000)
    currency: str | None = None
    purchase_date: date | None = None
    receipt_reference: str | None = None
    account_email: str | None = None
    confidence: float = Field(default=0.0, ge=0, le=1)
    extraction_method: str = "deterministic"
    warnings: list[str] = Field(default_factory=list)


class StoredReceipt(BaseModel):
    original_filename: str
    storage_filename: str
    content_type: str
    size_bytes: int
    sha256: str
    extraction: ReceiptExtraction
