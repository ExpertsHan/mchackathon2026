from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.enums import ApplicationStatus
from app.models import Application
from app.services.demo import DEMO_USER_IDS

RECEIPTS = Path(__file__).resolve().parents[2] / "demo" / "receipts"
CORRECT_ANSWERS = {
    "privacy": "C",
    "hallucinations": "B",
    "prompt-injection": "B",
    "human-responsibility": "B",
}


def login_as(client: TestClient, user_key: str) -> str:
    response = client.post("/api/demo/login", json={"user_id": str(DEMO_USER_IDS[user_key])})
    assert response.status_code == 200, response.text
    token = response.json()["demo_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return token


def create_application(client: TestClient, user_key: str) -> str:
    login_as(client, user_key)
    response = client.post("/api/applications", json={"user_id": str(DEMO_USER_IDS[user_key])})
    assert response.status_code == 200, response.text
    return response.json()["public_id"]


def upload(client: TestClient, public_id: str, receipt_name: str) -> dict:
    path = RECEIPTS / receipt_name
    response = client.post(
        f"/api/applications/{public_id}/receipt",
        files={"file": (path.name, path.read_bytes(), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def complete_safety(client: TestClient, user_key: str) -> None:
    modules = client.get("/api/safety/modules").json()
    for module in modules:
        response = client.post(
            f"/api/safety/modules/{module['id']}/answer",
            json={
                "user_id": str(DEMO_USER_IDS[user_key]),
                "answer": CORRECT_ANSWERS[module["slug"]],
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["correct"] is True


def test_complete_happy_path_policy_safety_submit_payment_tracking(
    client: TestClient,
) -> None:
    login = client.post("/api/demo/login", json={"user_id": str(DEMO_USER_IDS["alex"])})
    assert login.status_code == 200
    assert "Demo identity" in login.json()["notice"]

    public_id = create_application(client, "alex")
    policy = client.post(
        "/api/agent/chat",
        json={
            "user_id": str(DEMO_USER_IDS["alex"]),
            "application_id": public_id,
            "message": "Is ChatGPT Plus eligible?",
        },
    )
    assert policy.status_code == 200
    assert policy.json()["citations"]

    receipt = upload(client, public_id, "chatgpt_plus_valid.pdf")
    assert receipt["subscription"]["product"] == "ChatGPT Plus"
    assert "mock demo rate" in receipt["mock_exchange_rate"]

    provisional = client.post(f"/api/applications/{public_id}/eligibility/check")
    assert provisional.status_code == 200
    assert provisional.json()["provisionally_eligible"] is True

    blocked = client.post(f"/api/applications/{public_id}/submit")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "SAFETY_TRAINING_INCOMPLETE"

    complete_safety(client, "alex")
    progress = client.get(f"/api/users/{DEMO_USER_IDS['alex']}/safety-progress").json()
    assert progress["completed_required"] == 4
    assert progress["all_required_complete"] is True

    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["application"]["status"] == "APPROVED"
    assert submitted.json()["application"]["approved_amount_twd"] == "600.00"

    payment = client.post(f"/api/admin/applications/{public_id}/process-payment")
    assert payment.status_code == 200, payment.text
    assert payment.json()["status"] == "PAID"
    assert payment.json()["transaction_id"].startswith("GOVPAY-DEMO-")

    tracked = client.get(f"/api/applications/{public_id}/timeline")
    assert tracked.status_code == 200
    assert tracked.json()["status"] == "PAID"
    actions = [event["action"] for event in tracked.json()["events"]]
    assert "APPLICATION_APPROVED" in actions
    assert "PAYMENT_COMPLETED" in actions


def test_duplicate_receipt_enters_manual_review(client: TestClient) -> None:
    public_id = create_application(client, "jamie")
    uploaded = upload(client, public_id, "duplicate_receipt.pdf")
    assert uploaded["duplicate_receipt"] is True
    complete_safety(client, "jamie")
    result = client.post(f"/api/applications/{public_id}/submit")
    assert result.status_code == 200, result.text
    detail = result.json()
    assert detail["application"]["status"] == "MANUAL_REVIEW"
    assert detail["application"]["risk_level"] == "HIGH"
    assert any("Duplicate" in reason for reason in detail["application"]["risk_reasons_json"])


def test_underage_applicant_is_deterministically_rejected(client: TestClient) -> None:
    public_id = create_application(client, "taylor")
    upload(client, public_id, "claude_pro_valid.pdf")
    complete_safety(client, "taylor")
    result = client.post(f"/api/applications/{public_id}/submit")
    assert result.status_code == 200, result.text
    detail = result.json()
    assert detail["application"]["status"] == "REJECTED"
    age_check = next(
        item for item in detail["eligibility"]["checks"] if item["rule"] == "AGE_REQUIREMENT"
    )
    assert age_check["passed"] is False


def test_suspicious_claim_can_be_reviewed_with_audited_override(
    client: TestClient,
) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "malicious_prompt_injection_receipt.pdf")
    complete_safety(client, "alex")
    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.json()["application"]["status"] == "MANUAL_REVIEW"

    without_override = client.post(
        f"/api/admin/applications/{public_id}/approve",
        json={"reason": "Receipt manually verified", "override_review_flag": False},
    )
    assert without_override.status_code == 409
    approved = client.post(
        f"/api/admin/applications/{public_id}/approve",
        json={
            "reason": "Reviewer verified the valid fields and ignored the malicious document note.",
            "override_review_flag": True,
        },
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["application"]["status"] == "APPROVED"
    approval_events = [
        item for item in approved.json()["audit_logs"] if item["action"] == "APPLICATION_APPROVED"
    ]
    assert approval_events[-1]["actor_type"] == "REVIEWER"
    assert approval_events[-1]["details_json"]["review_flag_overridden"] is True


def test_malicious_receipt_is_flagged_without_executing_commands(
    client: TestClient,
) -> None:
    public_id = create_application(client, "alex")
    uploaded = upload(client, public_id, "malicious_prompt_injection_receipt.pdf")
    assert uploaded["subscription"]["product"] == "ChatGPT Plus"
    assert uploaded["subscription"]["suspicious_content"] is True
    detail = client.get(f"/api/applications/{public_id}").json()
    assert detail["application"]["status"] == "DRAFT"
    assert detail["payment"] is None


def test_payment_endpoint_rejects_draft(client: TestClient) -> None:
    public_id = create_application(client, "alex")
    response = client.post(f"/api/admin/applications/{public_id}/process-payment")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "PAYMENT_NOT_ALLOWED"


def test_receipt_evidence_cannot_be_rewritten_through_subscription_api(
    client: TestClient,
) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "chatgpt_plus_valid.pdf")
    rewrite = client.post(
        f"/api/applications/{public_id}/subscription",
        json={
            "provider": "Notion",
            "product": "Notion AI",
            "amount": "1.00",
            "currency": "TWD",
            "purchase_date": "2026-08-20",
        },
    )
    assert rewrite.status_code == 409
    assert rewrite.json()["error"]["code"] == "RECEIPT_EVIDENCE_LOCKED"
    evaluation = client.post(f"/api/applications/{public_id}/eligibility/check").json()
    product_check = next(
        check for check in evaluation["checks"] if check["rule"] == "ELIGIBLE_PRODUCT"
    )
    assert "ChatGPT Plus" in product_check["message"]
    assert evaluation["provisionally_eligible"] is True


def test_direct_column_tampering_conflicts_with_authoritative_extraction(
    client: TestClient,
    db: Session,
) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "chatgpt_plus_valid.pdf")
    application = db.query(Application).filter_by(public_id=public_id).one()
    application.subscription.provider = "Notion"
    application.subscription.product = "Notion AI"
    application.subscription.amount_twd = 1
    db.commit()

    evaluation = client.post(f"/api/applications/{public_id}/eligibility/check")
    assert evaluation.status_code == 200, evaluation.text
    body = evaluation.json()
    assert body["eligible"] is False
    assert body["requires_manual_review"] is True
    assert body["risk_level"] == "HIGH"
    assert any("conflicts with extracted" in reason for reason in body["risk_reasons"])
    product_check = next(check for check in body["checks"] if check["rule"] == "ELIGIBLE_PRODUCT")
    assert "ChatGPT Plus" in product_check["message"]


def test_citizen_auth_ownership_and_evidence_redaction(client: TestClient) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "chatgpt_plus_valid.pdf")
    citizen_detail = client.get(f"/api/applications/{public_id}")
    assert citizen_detail.status_code == 200
    citizen_subscription = citizen_detail.json()["subscription"]
    assert citizen_subscription["receipt_uploaded"] is True
    assert "receipt_hash" not in citizen_subscription
    assert "account_email" not in citizen_subscription
    assert "extraction_json" not in citizen_subscription
    assert all(
        "sha256" not in event["details_json"] for event in citizen_detail.json()["audit_logs"]
    )

    login_as(client, "jamie")
    forbidden = client.get(f"/api/applications/{public_id}")
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"
    forbidden_edit = client.post(
        f"/api/applications/{public_id}/subscription",
        json={"provider": "Notion", "product": "Notion AI"},
    )
    assert forbidden_edit.status_code == 403

    client.headers.pop("Authorization")
    unauthenticated = client.get(f"/api/applications/{public_id}")
    assert unauthenticated.status_code == 401
    admin_detail = client.get(f"/api/admin/applications/{public_id}")
    assert admin_detail.status_code == 200
    assert admin_detail.json()["subscription"]["receipt_hash"]
    assert admin_detail.json()["subscription"]["account_email"] == "alex@example.test"


def test_request_information_allows_safe_receipt_replacement_and_resubmit(
    client: TestClient,
) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "ambiguous_receipt.pdf")
    complete_safety(client, "alex")
    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.json()["application"]["status"] == "MANUAL_REVIEW"
    requested = client.post(
        f"/api/admin/applications/{public_id}/request-info",
        json={"reason": "Upload a receipt with a clear product and purchase date."},
    )
    assert requested.status_code == 200
    assert requested.json()["application"]["status"] == "REQUESTED_INFORMATION"

    replacement = upload(client, public_id, "chatgpt_plus_valid.pdf")
    assert replacement["subscription"]["product"] == "ChatGPT Plus"
    resubmitted = client.post(f"/api/applications/{public_id}/submit")
    assert resubmitted.status_code == 200, resubmitted.text
    assert resubmitted.json()["application"]["status"] == "APPROVED"
    assert resubmitted.json()["application"]["information_request"] is None


def test_direct_submit_retrieves_policy_before_decision(client: TestClient) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "chatgpt_plus_valid.pdf")
    complete_safety(client, "alex")
    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.status_code == 200
    assert submitted.json()["citations"]
    actions = [event["action"] for event in submitted.json()["audit_logs"]]
    policy_index = max(
        index for index, action in enumerate(actions) if action == "POLICY_RETRIEVED"
    )
    eligibility_index = max(
        index for index, action in enumerate(actions) if action == "ELIGIBILITY_EVALUATED"
    )
    assert policy_index < eligibility_index


def test_admin_verify_retrieves_policy_without_prior_eligibility_check(
    client: TestClient,
    db: Session,
) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "chatgpt_plus_valid.pdf")
    complete_safety(client, "alex")
    application = db.query(Application).filter_by(public_id=public_id).one()
    application.status = ApplicationStatus.SUBMITTED
    application.eligibility_result = None
    application.eligibility_reasons_json = []
    application.policy_citations_json = []
    db.commit()

    verified = client.post(f"/api/admin/applications/{public_id}/verify")
    assert verified.status_code == 200, verified.text
    assert verified.json()["application"]["status"] == "APPROVED"
    assert verified.json()["citations"]
    actions = [event["action"] for event in verified.json()["audit_logs"]]
    assert max(i for i, action in enumerate(actions) if action == "POLICY_RETRIEVED") < max(
        i for i, action in enumerate(actions) if action == "ELIGIBILITY_EVALUATED"
    )


def test_finalized_decision_detail_uses_recorded_snapshot(
    client: TestClient,
    db: Session,
) -> None:
    before = client.get("/api/admin/applications/AI-2026-000001").json()["eligibility"]
    assert before["eligible"] is True
    seeded = db.query(Application).filter_by(public_id="AI-2026-000001").one()
    seeded.user.age = 12
    seeded.subscription.product = "Unknown AI"
    db.commit()
    after = client.get("/api/admin/applications/AI-2026-000001").json()["eligibility"]
    assert after == before


def test_seeded_paid_claim_has_matching_completed_safety_progress(
    client: TestClient,
) -> None:
    login_as(client, "jamie")
    progress = client.get(f"/api/users/{DEMO_USER_IDS['jamie']}/safety-progress")
    assert progress.status_code == 200, progress.text
    assert progress.json()["completed_required"] == 4
    assert progress.json()["total_required"] == 4
    assert progress.json()["all_required_complete"] is True

    detail = client.get("/api/admin/applications/AI-2026-000001")
    assert detail.status_code == 200, detail.text
    assert detail.json()["application"]["status"] == "PAID"
    safety_check = next(
        check
        for check in detail.json()["eligibility"]["checks"]
        if check["rule"] == "SAFETY_TRAINING_COMPLETED"
    )
    assert safety_check["passed"] is True
    assert detail.json()["safety_progress"]["all_required_complete"] is True


def test_demo_reset_deletes_active_claim_reservations_and_is_repeatable(
    client: TestClient,
) -> None:
    public_id = create_application(client, "alex")
    upload(client, public_id, "chatgpt_plus_valid.pdf")
    complete_safety(client, "alex")
    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["application"]["status"] == "APPROVED"

    for _ in range(2):
        reset = client.post("/api/demo/reset")
        assert reset.status_code == 200, reset.text
        applications = client.get("/api/admin/applications")
        assert applications.status_code == 200, applications.text
        assert [item["public_id"] for item in applications.json()["items"]] == ["AI-2026-000001"]
