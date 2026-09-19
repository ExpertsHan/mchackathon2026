#!/usr/bin/env python3
"""Exercise the principal demo scenarios against a running backend."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.getenv("SMOKE_BASE_URL", "http://localhost:8000").rstrip("/")
CORRECT_ANSWERS = {
    "privacy": "C",
    "hallucinations": "B",
    "prompt-injection": "B",
    "human-responsibility": "B",
}


def call(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    file_path: Path | None = None,
    file_bytes: bytes | None = None,
    token: str | None = None,
) -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data: bytes | None = None
    if file_path is not None or file_bytes is not None:
        boundary = f"----ai-subsidy-{uuid.uuid4().hex}"
        if file_path is not None:
            file_bytes = file_path.read_bytes()
            filename, mime = file_path.name, "application/pdf"
        else:
            filename, mime = "document.png", "image/png"
        data = (
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'
                f"Content-Type: {mime}\r\n\r\n"
            ).encode()
            + file_bytes
            + f"\r\n--{boundary}--\r\n".encode()
        )
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            content = response.read()
            return json.loads(content) if content else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} returned {exc.code}: {body}") from exc


def reset() -> dict[str, dict[str, Any]]:
    call("POST", "/api/demo/reset")
    users = call("GET", "/api/demo/users")
    return {user["name"]: user for user in users}


PNG = b"\x89PNG\r\n\x1a\n"
FORM = {
    "phone": "0912345678",
    "birth_date": "2000-05-05",
    "household_address": "新竹市東區光復路一段1號",
    "mailing_address": "新竹市東區光復路一段1號",
    "applicant_type": "normal",
    "payment_type": "monthly",
    "software_category": "general",
    "applied_tool_name": "ChatGPT Plus",
    "software_company": "OpenAI",
    "purchase_date": (date.today() - timedelta(days=5)).isoformat(),
    "is_own_credit_card": True,
    "original_currency": "USD",
    "original_amount": 20,
    "declared_amount": 630,
}
REVIEWER = {"reviewer_name": "Smoke reviewer"}


def login(user: dict[str, Any]) -> str:
    token = call("POST", "/api/demo/login", {"user_id": user["id"]})["demo_token"]
    user["_demo_token"] = token
    return token


def start_application(user: dict[str, Any]) -> str:
    token = login(user)
    public_id = call("POST", "/api/applications", {"user_id": user["id"]}, token=token)["public_id"]
    call("POST", f"/api/applications/{public_id}/source-data", FORM, token=token)
    return public_id


def upload_documents(user: dict[str, Any], public_id: str) -> None:
    token = user["_demo_token"]
    for kind in ("id_card", "passbook", "declaration"):
        call(
            "POST",
            f"/api/applications/{public_id}/documents/{kind}",
            file_bytes=PNG + kind.encode(),
            token=token,
        )
    call(
        "POST",
        f"/api/applications/{public_id}/documents/receipt",
        file_path=ROOT / "demo" / "receipts" / "chatgpt_plus_valid.pdf",
        token=token,
    )


def policy_and_agent() -> None:
    users = reset()
    alex = users["Alex Chen"]
    token = login(alex)
    answer = call("POST", "/api/policy/search", {"query": "Is ChatGPT Plus eligible?"})
    assert answer["established"] is True and answer["citations"]
    banned = call("POST", "/api/policy/search", {"query": "Is CapCut eligible?"})
    assert banned["answer"].startswith("No.")
    unknown = call("POST", "/api/policy/search", {"query": "Is SuperNovaWriter eligible?"})
    assert unknown["established"] is False
    agent = call(
        "POST",
        "/api/agent/chat",
        {"user_id": alex["id"], "message": "Is ChatGPT Plus eligible?"},
        token=token,
    )
    assert agent["citations"]
    print("ok policy answers: eligible / prohibited / unlisted")


def intake_and_review() -> None:
    """Documents -> OCR -> RULE-001~020 -> human review. OCR needs GEMINI_API_KEY."""

    users = reset()
    alex = users["Alex Chen"]
    public_id = start_application(alex)
    token = alex["_demo_token"]
    early = None
    try:
        call("POST", f"/api/applications/{public_id}/submit", token=token)
    except RuntimeError as exc:
        early = str(exc)
    assert early and "DOCUMENTS_INCOMPLETE" in early, "submit must wait for every document"

    upload_documents(alex, public_id)
    submitted = call("POST", f"/api/applications/{public_id}/submit", token=token)
    status = submitted["application"]["status"]
    # The engine never approves. With OCR configured the case waits for a reviewer;
    # without Gemini the documents cannot be read and the applicant is asked to resubmit.
    assert status in {"MANUAL_REVIEW", "REQUESTED_INFORMATION"}, status
    assert submitted["application"]["approved_amount_twd"] is None
    assert len(call("GET", f"/api/admin/applications/{public_id}")["source_review"]["evaluation"]["rules"]) >= 17

    if status == "MANUAL_REVIEW":
        flagged = call("GET", f"/api/admin/applications/{public_id}")
        override = flagged["source_review"]["evaluation"]["result"] != "PASS"
        approved = call(
            "POST",
            f"/api/admin/applications/{public_id}/approve",
            {**REVIEWER, "reason": "Smoke test review", "override_review_flag": override},
        )
        assert approved["application"]["status"] == "APPROVED"
        paid = call("POST", f"/api/admin/applications/{public_id}/process-payment", REVIEWER)
        assert paid["status"] == "PAID"
        again = call("POST", f"/api/admin/applications/{public_id}/process-payment", REVIEWER)
        assert paid["transaction_id"] == again["transaction_id"]
        print(f"ok intake -> review -> payment: {public_id}")
    else:
        cancelled = call("POST", f"/api/applications/{public_id}/cancel", token=token)
        assert cancelled["application"]["status"] == "CANCELLED"
        print(f"ok intake without OCR ({public_id}): supplement requested, then cancelled")


def one_application_at_a_time() -> None:
    users = reset()
    jamie = users["Jamie Lin"]
    token = login(jamie)
    call("POST", "/api/applications", {"user_id": jamie["id"]}, token=token)
    try:
        call("POST", "/api/applications", {"user_id": jamie["id"]}, token=token)
    except RuntimeError as exc:
        assert "ACTIVE_APPLICATION_EXISTS" in str(exc)
    else:
        raise AssertionError("a second open application must be refused")
    stats = call("GET", "/api/admin/stats")
    assert stats["total_applications"] >= 2
    print("ok one open application per person")


def main() -> None:
    health = call("GET", "/health")
    if health["status"] != "ok":
        raise SystemExit(f"Backend is not healthy: {health}")
    # Reset twice up front to exercise FK-safe, idempotent cleanup with the
    # seeded receipt claim reservations present after the first reset.
    reset()
    reset()
    policy_and_agent()
    intake_and_review()
    one_application_at_a_time()
    print("all smoke scenarios passed")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, RuntimeError) as exc:
        print(f"smoke failure: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
