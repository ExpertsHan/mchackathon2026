"""The Node rule engine through the real bridge, and Copilot's mapping of its verdicts."""

from __future__ import annotations

import shutil

import pytest
from flow_helpers import id_card_ocr, passbook_ocr, receipt_ocr

from app.core.enums import EligibilityOutcome, RiskLevel
from app.services.eligibility import evaluation_from_review
from app.services.ocr_bridge import OcrUnavailable, call_bridge, sanitize_ocr_data

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is required")


def engine(**overrides) -> dict:
    application = {
        "name": "Alex Chen",
        "email": "alex@example.test",
        "birth_date": "2000-05-05",
        "applicant_type": "normal",
        "payment_type": "monthly",
        "software_category": "general",
        "purchase_date": "2026-07-10",
        "declared_amount": 630,
        "is_own_credit_card": True,
        **overrides.pop("application", {}),
    }
    documents = {
        "receipt": [{"ocr_status": "done", "ocr_data": receipt_ocr("alex")}],
        "id_card": [{"ocr_status": "done", "ocr_data": id_card_ocr("alex")}],
        "passbook": [{"ocr_status": "done", "ocr_data": passbook_ocr("alex")}],
        "declaration_uploaded": True,
        "cultural_proof_uploaded": False,
        "payer_declaration_uploaded": False,
        **overrides.pop("documents", {}),
    }
    return call_bridge(
        {
            "operation": "evaluate",
            "application": application,
            "documents": documents,
            "context": {"applicationDate": "2026-07-15", "duplicateApplicationId": None},
        }
    )


def test_engine_reports_all_rules_and_the_policy_parameters() -> None:
    result = engine()
    assert result["result"] == "PASS"
    assert [rule["id"] for rule in result["rules"]][0] == "RULE-001"
    assert len(result["rules"]) == 17  # 001-013, 017, 018, 019, 020
    assert result["subsidy"]["subsidy_amount"] == 315
    assert result["subsidy"]["subsidy_cap"] == 3000


@pytest.mark.parametrize(
    ("application", "expected"),
    [
        ({"birth_date": "2011-01-01"}, "REJECT"),  # too young (born after 2010-04-02)
        ({"birth_date": "1984-12-31"}, "REJECT"),  # too old (born before 1985-04-03)
        ({"birth_date": "2010-04-02"}, "PASS"),  # 16 is the youngest accepted age
        ({"purchase_date": "2026-04-01"}, "REJECT"),  # before the acceptance period
        ({"purchase_date": "2026-11-01"}, "REJECT"),  # after the acceptance period
    ],
)
def test_policy_boundaries_are_owned_by_the_engine(application: dict, expected: str) -> None:
    result = engine(application=application)
    # Deadline is relative to the fixed application date, so isolate the rule under test.
    rules = {rule["id"]: rule["result"] for rule in result["rules"]}
    if expected == "PASS":
        assert rules["RULE-001"] is None
    else:
        assert "REJECT" in {rules["RULE-001"], rules["RULE-003"]}


def test_special_and_language_categories_use_the_higher_rate() -> None:
    special = engine(
        application={"applicant_type": "special"}, documents={"cultural_proof_uploaded": True}
    )
    assert special["subsidy"]["subsidy_rate"] == 0.9
    assert special["subsidy"]["subsidy_amount"] == 567
    missing_proof = engine(application={"applicant_type": "language"})
    rules = {rule["id"]: rule["result"] for rule in missing_proof["rules"]}
    assert rules["RULE-015"] == "NEED_SUPPLEMENT"


def test_prohibited_and_aggregator_purchases_are_rejected() -> None:
    banned = engine(
        documents={
            "receipt": [
                {
                    "ocr_status": "done",
                    "ocr_data": receipt_ocr(
                        "alex", product_name="CapCut Pro", company_name="ByteDance"
                    ),
                }
            ]
        }
    )
    assert {rule["id"]: rule["result"] for rule in banned["rules"]}["RULE-006"] == "REJECT"
    reseller = engine(
        documents={
            "receipt": [
                {"ocr_status": "done", "ocr_data": receipt_ocr("alex", purchase_source="poe.com")}
            ]
        }
    )
    assert {rule["id"]: rule["result"] for rule in reseller["rules"]}["RULE-007"] == "REJECT"


def test_unknown_amount_is_unknown_not_zero() -> None:
    receipt = receipt_ocr("alex", converted_twd_amount=None)
    result = engine(
        application={"declared_amount": None},
        documents={"receipt": [{"ocr_status": "done", "ocr_data": receipt}]},
    )
    assert result["subsidy"]["unknown"] is True
    assert result["subsidy"]["subsidy_amount"] is None
    assert evaluation_from_review(result).estimated_amount_twd == 0


@pytest.mark.parametrize(
    ("verdict", "outcome", "risk"),
    [
        ("PASS", EligibilityOutcome.ELIGIBLE, RiskLevel.LOW),
        ("NEED_SUPPLEMENT", EligibilityOutcome.MANUAL_REVIEW, RiskLevel.MEDIUM),
        ("REVIEW", EligibilityOutcome.MANUAL_REVIEW, RiskLevel.MEDIUM),
        ("REJECT", EligibilityOutcome.INELIGIBLE, RiskLevel.MEDIUM),
        ("FRAUD_RISK", EligibilityOutcome.MANUAL_REVIEW, RiskLevel.HIGH),
    ],
)
def test_verdict_mapping_never_approves_automatically(verdict, outcome, risk) -> None:
    mapped = evaluation_from_review(
        {"result": verdict, "rules": [], "subsidy": {"subsidy_amount": 315, "unknown": False}}
    )
    assert mapped.outcome is outcome
    assert mapped.risk_level is risk
    assert mapped.requires_manual_review is True
    assert mapped.approved_amount_twd == 0
    assert mapped.estimated_amount_twd == 315


def test_bridge_rejects_unknown_operations_and_hides_failures() -> None:
    with pytest.raises(OcrUnavailable):
        call_bridge({"operation": "delete-everything"})


def test_ocr_output_is_sanitized_before_it_is_stored() -> None:
    clean = sanitize_ocr_data(
        {
            "buyer_name": "Alex",
            "original_amount": 10**9,
            "evil": "<script>",
            "has_payment_proof": "yes",
            "_confidence": {"buyer_name": 0.9, "evil": 1, "original_amount": 5},
        }
    )
    assert clean == {"buyer_name": "Alex", "_confidence": {"buyer_name": 0.9}}
