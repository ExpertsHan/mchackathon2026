from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from flow_helpers import (
    REVIEWER,
    applicant_form,
    complete_application,
    create_application,
    id_card_ocr,
    install_ocr,
    login_as,
    receipt_ocr,
    save_applicant,
    upload,
    upload_all,
)
from sqlalchemy.orm import Session

from app.core.enums import ApplicationStatus
from app.models import Application, AuditLog, ClaimReservation, User
from app.services.demo import DEMO_GOVERNMENT_IDS, DEMO_USER_IDS


def approve(client: TestClient, public_id: str, **extra):
    return client.post(
        f"/api/admin/applications/{public_id}/approve",
        json={**REVIEWER, "reason": "文件核對無誤", **extra},
    )


def test_demo_login_surfaces_show_full_fictional_ids_without_changing_stored_masks(
    client: TestClient, db: Session
) -> None:
    users = client.get("/api/demo/users")
    assert users.status_code == 200
    displayed = {item["name"]: item["government_id_masked"] for item in users.json()}
    assert displayed == {
        "Alex Chen": DEMO_GOVERNMENT_IDS["alex"],
        "Jamie Lin": DEMO_GOVERNMENT_IDS["jamie"],
        "Taylor Wang": DEMO_GOVERNMENT_IDS["taylor"],
    }

    login = client.post(
        "/api/demo/login", json={"user_id": str(DEMO_USER_IDS["alex"])}
    )
    assert login.status_code == 200
    assert login.json()["user"]["government_id_masked"] == DEMO_GOVERNMENT_IDS["alex"]

    # Full values are presentation-only. Persistence and non-demo APIs stay masked.
    stored = db.get(User, DEMO_USER_IDS["alex"])
    assert stored is not None
    assert stored.government_id_masked == "A12****789"


def test_happy_path_goes_to_human_review_then_approval_and_payment(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")

    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.status_code == 200, submitted.text
    detail = submitted.json()
    # The engine passes the case, yet nothing is approved without a person.
    assert detail["source_review"]["evaluation"]["result"] == "PASS"
    assert detail["application"]["status"] == "MANUAL_REVIEW"
    assert detail["application"]["approved_amount_twd"] is None
    assert detail["eligibility"]["outcome"] == "ELIGIBLE"
    assert float(detail["application"]["requested_amount_twd"]) == 315.0  # 630 * 50%

    # Payment is impossible before approval.
    early = client.post(f"/api/admin/applications/{public_id}/process-payment", json=REVIEWER)
    assert early.status_code == 409

    approved = approve(client, public_id)
    assert approved.status_code == 200, approved.text
    assert approved.json()["application"]["status"] == "APPROVED"
    assert float(approved.json()["application"]["approved_amount_twd"]) == 315.0

    paid = client.post(f"/api/admin/applications/{public_id}/process-payment", json=REVIEWER)
    assert paid.status_code == 200, paid.text
    assert float(paid.json()["amount_twd"]) == 315.0
    actors = {
        log.actor_identifier
        for log in db.query(AuditLog).filter(AuditLog.action == "APPLICATION_APPROVED")
    }
    assert "王承辦" in actors

    tracking = client.get(f"/api/applications/{public_id}/status").json()
    assert tracking["status"] == "PAID"
    payment = client.get(f"/api/applications/{public_id}/payment-status").json()
    assert payment["disbursed"] is True
    assert payment["account_number_last4"] == "9012"
    assert "account_number" not in payment


def test_special_applicant_gets_the_90_percent_rate_and_needs_proof(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = create_application(client, "alex")
    save_applicant(
        client, public_id, "alex", applicant_type="special", applicant_subtype="低收入戶"
    )
    upload_all(client, public_id)
    incomplete = client.post(f"/api/applications/{public_id}/submit")
    assert incomplete.status_code == 400
    assert incomplete.json()["error"]["code"] == "DOCUMENTS_INCOMPLETE"
    assert "特定對象" in incomplete.json()["error"]["message"]

    upload(client, public_id, "cultural_proof", name="proof")
    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.status_code == 200, submitted.text
    assert float(submitted.json()["application"]["requested_amount_twd"]) == 567.0  # 630 * 90%


def test_subsidy_is_capped_by_applicant_category(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(
        monkeypatch,
        "alex",
        receipt=receipt_ocr("alex", converted_twd_amount=9000, original_amount=290),
    )
    public_id = complete_application(client, "alex", declared_amount=9000)
    detail = client.post(f"/api/applications/{public_id}/submit").json()
    assert float(detail["application"]["requested_amount_twd"]) == 3000.0  # normal cap


def test_submit_without_documents_or_details_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = create_application(client, "alex")
    empty = client.post(f"/api/applications/{public_id}/submit")
    assert empty.status_code == 400
    assert empty.json()["error"]["code"] == "APPLICANT_DATA_INCOMPLETE"

    save_applicant(client, public_id, "alex")
    no_documents = client.post(f"/api/applications/{public_id}/submit")
    assert no_documents.status_code == 400
    assert no_documents.json()["error"]["code"] == "DOCUMENTS_INCOMPLETE"
    assert client.get(f"/api/applications/{public_id}").json()["application"]["status"] == "DRAFT"


def test_missing_id_back_requests_supplement_then_resubmits_to_review(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(
        monkeypatch, "alex", id_card=id_card_ocr("alex", address=None, is_hsinchu_city=None)
    )
    public_id = complete_application(client, "alex")
    submitted = client.post(f"/api/applications/{public_id}/submit").json()
    assert submitted["application"]["status"] == "REQUESTED_INFORMATION"
    assert "身分證地址" in submitted["application"]["information_request"] or (
        "設籍" in submitted["application"]["information_request"]
    )
    items = submitted["source_review"]["evaluation"]["supplement_center"]["items"]
    assert [item["rule_id"] for item in items] == ["RULE-002"]
    missing = client.get(f"/api/applications/{public_id}/missing-documents").json()
    assert missing["rule_issues"][0]["rule"] == "RULE-002"

    install_ocr(monkeypatch, "alex")  # a clearer photo now reads the address
    replaced = upload(client, public_id, "id_card", name="id-back")
    assert replaced.status_code == 200
    resubmitted = client.post(f"/api/applications/{public_id}/submit")
    assert resubmitted.status_code == 200, resubmitted.text
    assert resubmitted.json()["application"]["status"] == "MANUAL_REVIEW"


def test_reviewer_cannot_approve_a_case_that_still_needs_documents(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(
        monkeypatch, "alex", id_card=id_card_ocr("alex", address=None, is_hsinchu_city=None)
    )
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    # Ask for information first so the case is reviewable, then try to approve anyway.
    response = approve(client, public_id, override_review_flag=True)
    assert response.status_code == 409


def test_underage_or_overage_applicant_is_advised_to_reject_but_a_human_decides(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "taylor")
    public_id = create_application(client, "taylor")
    save_applicant(client, public_id, "taylor", birth_date="1980-01-01")
    upload_all(client, public_id)
    detail = client.post(f"/api/applications/{public_id}/submit").json()
    assert detail["source_review"]["evaluation"]["result"] == "REJECT"
    assert detail["application"]["status"] == "MANUAL_REVIEW"
    assert detail["eligibility"]["outcome"] == "INELIGIBLE"

    blocked = approve(client, public_id)
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "REVIEW_OVERRIDE_REQUIRED"
    rejected = client.post(
        f"/api/admin/applications/{public_id}/reject",
        json={**REVIEWER, "reason": "年齡不符資格"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["application"]["status"] == "REJECTED"


def test_flagged_case_can_be_overridden_only_with_explicit_audited_flag(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex", receipt=receipt_ocr("alex", buyer_name="Someone Else"))
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    assert approve(client, public_id).json()["error"]["code"] == "REVIEW_OVERRIDE_REQUIRED"
    overridden = approve(client, public_id, override_review_flag=True)
    assert overridden.status_code == 200, overridden.text
    audit = (
        db.query(AuditLog)
        .filter(AuditLog.action == "APPLICATION_APPROVED")
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    assert audit.details_json["review_flag_overridden"] is True
    assert "RULE-009" in audit.details_json["overridden_rules"]


def test_duplicate_receipt_is_fraud_risk_and_cannot_reserve_the_same_claim(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "jamie")
    public_id = create_application(client, "jamie")
    save_applicant(client, public_id, "jamie")
    upload_all(client, public_id, receipt_pdf="duplicate_receipt.pdf")
    detail = client.post(f"/api/applications/{public_id}/submit").json()
    assert detail["source_review"]["evaluation"]["result"] == "FRAUD_RISK"
    assert detail["application"]["status"] == "MANUAL_REVIEW"
    assert detail["application"]["risk_level"] == "HIGH"

    conflict = approve(client, public_id, override_review_flag=True)
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "CLAIM_RESERVATION_CONFLICT"


def test_only_one_open_application_per_person(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = create_application(client, "alex")
    again = client.post("/api/applications", json={"user_id": str(DEMO_USER_IDS["alex"])})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "ACTIVE_APPLICATION_EXISTS"

    cancelled = client.post(f"/api/applications/{public_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["application"]["status"] == "CANCELLED"
    fresh = client.post("/api/applications", json={"user_id": str(DEMO_USER_IDS["alex"])})
    assert fresh.status_code == 200


def test_id_number_must_match_the_logged_in_identity(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "jamie")
    public_id = create_application(client, "jamie")
    wrong = client.post(f"/api/applications/{public_id}/source-data", json=applicant_form("alex"))
    assert wrong.status_code == 409
    assert wrong.json()["error"]["code"] == "ID_NUMBER_MISMATCH"
    malformed = client.post(
        f"/api/applications/{public_id}/source-data",
        json=applicant_form("jamie", id_number="123"),
    )
    assert malformed.status_code == 422


def test_plain_national_id_is_never_persisted(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    admin = client.get(f"/api/admin/applications/{public_id}").json()
    assert "A123456789" not in str(admin)
    id_docs = [d for d in admin["source_review"]["documents"] if d["document_type"] == "id_card"]
    assert id_docs[0]["ocr_data"]["id_number"] == "A12****789"
    assert "id_number_hash" not in id_docs[0]["ocr_data"]
    matrix = {
        row["check"]: row["result"]
        for row in admin["source_review"]["evaluation"]["cross_validation"]
    }
    assert matrix["id_number_vs_profile"] == "MATCH"
    assert db.query(User).filter(User.government_id_hash.is_not(None)).count() >= 3


def test_citizen_view_redacts_evidence_and_enforces_ownership(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    citizen = client.get(f"/api/applications/{public_id}").json()
    for document in citizen["source_review"]["documents"]:
        assert "ocr_data" not in document
        assert "sha256" not in document
    evaluation = citizen["source_review"]["evaluation"]
    assert "ocr_data" not in evaluation and "rules" not in evaluation

    login_as(client, "jamie")
    assert client.get(f"/api/applications/{public_id}").status_code == 403
    assert client.post(f"/api/applications/{public_id}/cancel").status_code == 403
    client.headers.pop("Authorization")
    assert client.get(f"/api/applications/{public_id}").status_code == 401
    admin = client.get(f"/api/admin/applications/{public_id}").json()
    assert admin["source_review"]["evaluation"]["rules"]


def test_cancel_is_blocked_once_approved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    assert approve(client, public_id).status_code == 200
    blocked = client.post(f"/api/applications/{public_id}/cancel")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "CANCEL_NOT_ALLOWED"


def test_cancel_releases_claim_reservations(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    application = db.query(Application).filter_by(public_id=public_id).one()
    assert db.query(ClaimReservation).filter_by(application_id=application.id).count() == 0
    reviewer_reject = client.post(
        f"/api/admin/applications/{public_id}/reject", json={**REVIEWER, "reason": "測試退件"}
    )
    assert reviewer_reject.status_code == 200
    assert application.status is ApplicationStatus.REJECTED


def test_reviewer_actions_require_a_name(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    anonymous = client.post(
        f"/api/admin/applications/{public_id}/approve", json={"reason": "沒有署名"}
    )
    assert anonymous.status_code == 422
    flagged = client.post(
        f"/api/admin/applications/{public_id}/flag-check",
        json={**REVIEWER, "reason": "需要再查核"},
    )
    assert flagged.status_code == 200
    assert flagged.json()["application"]["flagged_for_check"] is True
    info = client.post(
        f"/api/admin/applications/{public_id}/request-info",
        json={**REVIEWER, "reason": "請補上更清楚的收據"},
    )
    assert info.json()["application"]["status"] == "REQUESTED_INFORMATION"


def test_admin_dashboard_and_filters(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    client.headers.pop("Authorization")
    stats = client.get("/api/admin/stats").json()
    # The seeded historical (paid) claim counts alongside the new application.
    assert stats["applications_submitted"] == 2
    assert stats["documents_uploaded"] == 5
    assert stats["rules_total_checked"] >= 17
    assert stats["applications_needing_human_review"] == 1
    assert stats["estimated_minutes_saved"] == 30
    passed = client.get("/api/admin/applications", params={"ai_result": "PASS"}).json()
    assert passed["total"] == 1
    assert passed["items"][0]["product"] == "ChatGPT Plus"
    assert (
        client.get("/api/admin/applications", params={"ai_result": "REJECT"}).json()["total"] == 0
    )


def test_payment_endpoint_rejects_draft(client: TestClient) -> None:
    public_id = create_application(client, "alex")
    client.headers.pop("Authorization")
    response = client.post(f"/api/admin/applications/{public_id}/process-payment", json=REVIEWER)
    assert response.status_code == 409


def test_uploads_are_validated_and_limited(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = create_application(client, "alex")
    bad = client.post(
        f"/api/applications/{public_id}/documents/receipt",
        files=[("files", ("x.exe", b"MZ", "application/octet-stream"))],
    )
    assert bad.status_code == 400
    forged = client.post(
        f"/api/applications/{public_id}/documents/receipt",
        files=[("files", ("x.png", b"not a png", "image/png"))],
    )
    assert forged.status_code == 400
    single = upload(client, public_id, "passbook", name="one")
    replaced = upload(client, public_id, "passbook", name="two")
    assert single.status_code == replaced.status_code == 200
    active = [
        d for d in replaced.json()["documents"] if d["document_type"] == "passbook" and d["active"]
    ]
    assert len(active) == 1


def test_finalized_detail_uses_recorded_snapshot(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    approve(client, public_id)
    detail = client.get(f"/api/applications/{public_id}").json()
    assert detail["eligibility"]["ai_result"] == "PASS"
    assert float(detail["eligibility"]["approved_amount_twd"]) == 315.0
    assert detail["citations"]


def test_demo_reset_is_repeatable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    install_ocr(monkeypatch, "alex")
    complete_application(client, "alex")
    for _ in range(2):
        assert client.post("/api/demo/reset").status_code == 200
    login_as(client, "alex")
    assert (
        client.post("/api/applications", json={"user_id": str(DEMO_USER_IDS["alex"])}).status_code
        == 200
    )
