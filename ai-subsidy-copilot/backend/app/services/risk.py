"""Small deterministic risk classifier; no model output controls this result."""

from __future__ import annotations

from app.core.config import settings
from app.core.enums import RiskLevel
from app.schemas import EligibilityInput, RiskAssessment


def assess_risk(
    data: EligibilityInput,
    *,
    product_known: bool,
    provider_consistent: bool,
) -> RiskAssessment:
    high: list[str] = []
    medium: list[str] = []

    if data.duplicate_receipt:
        high.append("Duplicate receipt fingerprint detected.")
    if data.monthly_claim_exists:
        high.append("The applicant already has a successful claim for this calendar month.")
    if data.suspicious_receipt:
        high.append("Suspicious content was detected in the uploaded receipt.")
    if data.claim_reservation_conflicts:
        high.append("Another application reserved the same receipt or monthly claim key.")
    if data.inconsistent_fields:
        high.append(
            "Receipt fields are inconsistent: " + ", ".join(sorted(data.inconsistent_fields)) + "."
        )
    if data.product and product_known and data.provider and not provider_consistent:
        high.append("The extracted provider and product do not match.")

    if not data.product or not product_known:
        medium.append("The receipt product could not be matched to the eligible product list.")
    if not data.provider:
        medium.append("The receipt provider could not be established.")
    if data.purchase_date is None:
        medium.append("The receipt purchase date could not be established.")
    if not data.receipt_hash:
        medium.append("A receipt fingerprint is unavailable.")
    if data.amount_twd is None or data.amount_twd <= 0:
        medium.append("A plausible receipt amount could not be established.")
    if (
        data.extraction_confidence is None
        or data.extraction_confidence < settings.minimum_extraction_confidence
    ):
        medium.append("Receipt extraction confidence is below the automatic-review threshold.")
    if data.extraction_method == "openai-vision":
        medium.append(
            "Vision-only receipt extraction requires deterministic or human verification."
        )
    if not data.policy_established:
        medium.append("Current policy evidence could not be retrieved for this decision.")

    if high:
        return RiskAssessment(
            level=RiskLevel.HIGH,
            reasons=high + medium,
            requires_manual_review=True,
        )
    if medium:
        return RiskAssessment(
            level=RiskLevel.MEDIUM,
            reasons=medium,
            requires_manual_review=True,
        )
    return RiskAssessment(level=RiskLevel.LOW, reasons=[], requires_manual_review=False)
