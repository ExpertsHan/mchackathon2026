"""Shared builders for end-to-end application flows with a scripted OCR provider.

The rule engine (Node) runs for real; only the Gemini vision call is replaced, so the
tests exercise RULE-001~020 exactly as production does.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services.demo import DEMO_USER_IDS
from app.services.ocr_bridge import protect_identifiers

RECEIPTS = Path(__file__).resolve().parents[2] / "demo" / "receipts"
TODAY = date(2026, 7, 15)
PNG = b"\x89PNG\r\n\x1a\n"

NAMES = {"alex": "Alex Chen", "jamie": "Jamie Lin", "taylor": "Taylor Wang"}
ID_NUMBERS = {"alex": "A123456789", "jamie": "B234567456", "taylor": "C345678123"}
EMAILS = {
    "alex": "alex@example.test",
    "jamie": "jamie@example.test",
    "taylor": "taylor@example.test",
}


def _confidence(data: dict) -> dict:
    return {key: 0.95 for key, value in data.items() if value is not None}


def receipt_ocr(user: str = "alex", **overrides) -> dict:
    data = {
        "document_type": "official_receipt",
        "buyer_name": NAMES[user],
        "buyer_email": EMAILS[user],
        "product_name": "ChatGPT Plus",
        "company_name": "OpenAI",
        "purchase_date": "2026-07-10",
        "subscription_period": "2026-07-10 to 2026-08-10",
        "original_amount": 20,
        "currency": "USD",
        "converted_twd_amount": 630,
        "payment_method": "信用卡",
        "purchase_source": "chatgpt.com",
        "plan_type": "月付方案",
        "has_payment_proof": True,
        **overrides,
    }
    return {**data, "_confidence": _confidence(data)}


def id_card_ocr(user: str = "alex", **overrides) -> dict:
    data = {
        "side": "back",
        "name": NAMES[user],
        "id_number": ID_NUMBERS[user],
        "birth_date": "2000-05-05",
        "address": "新竹市東區光復路一段1號",
        "is_hsinchu_city": True,
        **overrides,
    }
    return {**data, "_confidence": _confidence(data)}


def passbook_ocr(user: str = "alex", **overrides) -> dict:
    data = {
        "bank_name": "臺灣銀行",
        "bank_code": "004",
        "account_number": "123456789012",
        "account_holder_name": NAMES[user],
        **overrides,
    }
    return {**data, "_confidence": _confidence(data)}


def install_ocr(monkeypatch: pytest.MonkeyPatch, user: str, **documents: dict) -> None:
    """Script OCR results by document type; unspecified types read normally."""

    scripted = {
        "receipt": receipt_ocr(user),
        "id_card": id_card_ocr(user),
        "passbook": passbook_ocr(user),
        **documents,
    }

    def fake_extract(_data: bytes, _suffix: str, document_type: str) -> dict:
        if document_type not in scripted:
            return {"status": "uploaded", "data": {}}
        return {"status": "done", "data": protect_identifiers(dict(scripted[document_type]))}

    monkeypatch.setattr("app.services.source_review.extract_document", fake_extract)
    monkeypatch.setattr("app.services.source_review._today", lambda: TODAY)
    # Submission time drives the RULE-004 deadline; pin it to the scripted "today".
    monkeypatch.setattr(
        "app.services.state_machine.utcnow",
        lambda: datetime(TODAY.year, TODAY.month, TODAY.day, 9, tzinfo=UTC),
    )


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


def applicant_form(user: str = "alex", **overrides) -> dict:
    return {
        "id_number": ID_NUMBERS[user],
        "name": {"alex": "Alex Chen", "jamie": "Jamie Lin", "taylor": "Taylor Wang"}[user],
        "phone": "0912345678",
        "birth_date": "2000-05-05",
        "household_address": "新竹市東區光復路一段1號",
        "mailing_address": "新竹市東區光復路一段1號",
        "applicant_type": "normal",
        "payment_type": "monthly",
        "software_category": "general",
        "applied_tool_name": "ChatGPT Plus",
        "software_company": "OpenAI",
        "purchase_date": "2026-07-10",
        "is_own_credit_card": True,
        "original_currency": "USD",
        "original_amount": 20,
        "declared_amount": 630,
        **overrides,
    }


def save_applicant(client: TestClient, public_id: str, user: str = "alex", **overrides) -> dict:
    response = client.post(
        f"/api/applications/{public_id}/source-data", json=applicant_form(user, **overrides)
    )
    assert response.status_code == 200, response.text
    return response.json()


def upload(
    client: TestClient, public_id: str, document_type: str, *, name: str = "doc", pdf: str = ""
):
    if pdf:
        path = RECEIPTS / pdf
        files = [("files", (path.name, path.read_bytes(), "application/pdf"))]
    else:
        files = [("files", (f"{name}.png", PNG + name.encode(), "image/png"))]
    return client.post(f"/api/applications/{public_id}/documents/{document_type}", files=files)


def upload_all(
    client: TestClient, public_id: str, *, receipt_pdf: str = "chatgpt_plus_valid.pdf", extra=()
) -> dict:
    result: dict = {}
    for kind in ("id_card", "passbook", "declaration", *extra):
        response = upload(client, public_id, kind, name=f"{kind}-{public_id}")
        assert response.status_code == 200, response.text
    response = upload(client, public_id, "receipt", pdf=receipt_pdf)
    assert response.status_code == 200, response.text
    result = response.json()
    return result


def complete_application(client: TestClient, user: str, **form) -> str:
    public_id = create_application(client, user)
    save_applicant(client, public_id, user, **form)
    upload_all(client, public_id)
    return public_id


REVIEWER = {"reviewer_name": "王承辦"}
