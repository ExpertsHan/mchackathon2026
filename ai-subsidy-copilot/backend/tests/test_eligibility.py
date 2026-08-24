from datetime import date
from decimal import Decimal

import pytest

from app.core.enums import EligibilityOutcome, EligibilityRule, RiskLevel
from app.schemas import EligibilityInput
from app.services.eligibility import calculate_subsidy, evaluate_eligibility


def valid_input(**overrides) -> EligibilityInput:
    values = {
        "age": 21,
        "identity_verified": True,
        "provider": "OpenAI",
        "product": "ChatGPT Plus",
        "purchase_date": date(2026, 8, 18),
        "receipt_hash": "a" * 64,
        "amount_twd": Decimal("600"),
        "safety_complete": True,
        "duplicate_receipt": False,
        "monthly_claim_exists": False,
        "extraction_confidence": 1.0,
    }
    values.update(overrides)
    return EligibilityInput(**values)


def check(result, rule: EligibilityRule):
    return next(item for item in result.checks if item.rule is rule)


def test_valid_adult_chatgpt_receipt_is_eligible() -> None:
    result = evaluate_eligibility(valid_input())
    assert result.eligible is True
    assert result.outcome is EligibilityOutcome.ELIGIBLE
    assert result.risk_level is RiskLevel.LOW
    assert result.approved_amount_twd == Decimal("600.00")


def test_age_17_fails_age_rule() -> None:
    result = evaluate_eligibility(valid_input(age=17))
    assert result.eligible is False
    assert result.outcome is EligibilityOutcome.INELIGIBLE
    assert check(result, EligibilityRule.AGE_REQUIREMENT).passed is False
    assert check(result, EligibilityRule.AGE_REQUIREMENT).blocking is True


def test_unknown_product_is_not_auto_approved() -> None:
    result = evaluate_eligibility(valid_input(provider="Google", product="Gemini Advanced"))
    assert result.eligible is False
    assert result.requires_manual_review is True
    assert result.outcome is EligibilityOutcome.MANUAL_REVIEW


def test_duplicate_receipt_requires_high_risk_review() -> None:
    result = evaluate_eligibility(valid_input(duplicate_receipt=True))
    assert result.eligible is False
    assert result.requires_manual_review is True
    assert result.risk_level is RiskLevel.HIGH
    assert check(result, EligibilityRule.RECEIPT_NOT_DUPLICATED).passed is False


def test_monthly_duplicate_requires_high_risk_review() -> None:
    result = evaluate_eligibility(valid_input(monthly_claim_exists=True))
    assert result.eligible is False
    assert result.requires_manual_review is True
    assert result.risk_level is RiskLevel.HIGH
    assert check(result, EligibilityRule.MONTHLY_LIMIT).passed is False


def test_safety_incomplete_is_only_provisional_and_cannot_submit() -> None:
    result = evaluate_eligibility(valid_input(safety_complete=False))
    assert result.eligible is False
    assert result.provisionally_eligible is True
    assert result.outcome is EligibilityOutcome.PROVISIONALLY_ELIGIBLE
    assert check(result, EligibilityRule.SAFETY_TRAINING_COMPLETED).passed is False


@pytest.mark.parametrize(
    ("amount", "expected"),
    [(Decimal("700"), Decimal("600.00")), (Decimal("480"), Decimal("480.00"))],
)
def test_subsidy_is_capped_or_uses_lower_cost(amount: Decimal, expected: Decimal) -> None:
    assert calculate_subsidy(amount) == expected


def test_low_confidence_is_medium_not_high() -> None:
    result = evaluate_eligibility(valid_input(extraction_confidence=0.5))
    assert result.risk_level is RiskLevel.MEDIUM
    assert result.requires_manual_review is True
