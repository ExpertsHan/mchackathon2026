#!/usr/bin/env python3
"""Exercise the principal demo scenarios against a running backend."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
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
    token: str | None = None,
) -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data: bytes | None = None
    if file_path is not None:
        boundary = f"----ai-subsidy-{uuid.uuid4().hex}"
        file_bytes = file_path.read_bytes()
        data = (
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
                "Content-Type: application/pdf\r\n\r\n"
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


def create_application(user: dict[str, Any], provider: str, product: str) -> str:
    login = call("POST", "/api/demo/login", {"user_id": user["id"]})
    token = login["demo_token"]
    user["_demo_token"] = token
    application = call("POST", "/api/applications", {"user_id": user["id"]}, token=token)
    public_id = application["public_id"]
    call(
        "POST",
        f"/api/applications/{public_id}/subscription",
        {"provider": provider, "product": product},
        token=token,
    )
    return public_id


def complete_safety(user: dict[str, Any]) -> None:
    token = user["_demo_token"]
    modules = call("GET", "/api/safety/modules", token=token)
    for module in modules:
        result = call(
            "POST",
            f"/api/safety/modules/{module['id']}/answer",
            {"user_id": user["id"], "answer": CORRECT_ANSWERS[module["slug"]]},
            token=token,
        )
        assert result["correct"] is True, module["slug"]
    progress = call("GET", f"/api/users/{user['id']}/safety-progress", token=token)
    assert progress["all_required_complete"] is True
    assert progress["completed_required"] == progress["total_required"] == 4


def happy_path() -> None:
    users = reset()
    alex = users["Alex Chen"]
    public_id = create_application(alex, "OpenAI", "ChatGPT Plus")

    answer = call("POST", "/api/policy/search", {"query": "Is ChatGPT Plus eligible?"})
    assert answer["established"] is True and answer["citations"]
    unknown = call("POST", "/api/policy/search", {"query": "Is Gemini Advanced eligible?"})
    assert unknown["established"] is False
    agent = call(
        "POST",
        "/api/agent/chat",
        {
            "user_id": alex["id"],
            "application_id": public_id,
            "message": "Is ChatGPT Plus eligible?",
        },
        token=alex["_demo_token"],
    )
    assert agent["citations"]

    receipt = call(
        "POST",
        f"/api/applications/{public_id}/receipt",
        file_path=ROOT / "demo" / "receipts" / "chatgpt_plus_valid.pdf",
        token=alex["_demo_token"],
    )
    assert receipt["subscription"]["product"] == "ChatGPT Plus"
    assert receipt["subscription"]["amount_twd"] == "600.00"

    provisional = call(
        "POST",
        f"/api/applications/{public_id}/eligibility/check",
        token=alex["_demo_token"],
    )
    assert provisional["provisionally_eligible"] is True
    complete_safety(alex)
    eligible = call(
        "POST",
        f"/api/applications/{public_id}/eligibility/check",
        token=alex["_demo_token"],
    )
    assert eligible["eligible"] is True
    assert eligible["approved_amount_twd"] == "600.00"

    submitted = call("POST", f"/api/applications/{public_id}/submit", token=alex["_demo_token"])
    assert submitted["application"]["status"] == "APPROVED"
    first_payment = call("POST", f"/api/admin/applications/{public_id}/process-payment")
    second_payment = call("POST", f"/api/admin/applications/{public_id}/process-payment")
    assert first_payment["status"] == "PAID"
    assert first_payment["transaction_id"] == second_payment["transaction_id"]
    timeline = call("GET", f"/api/applications/{public_id}/timeline", token=alex["_demo_token"])
    assert timeline["status"] == "PAID"
    assert timeline["payment"]["amount_twd"] == "600.00"
    print(f"ok happy path: {public_id} → {first_payment['transaction_id']}")


def manual_review_path() -> None:
    users = reset()
    alex = users["Alex Chen"]
    public_id = create_application(alex, "OpenAI", "ChatGPT Plus")
    receipt = call(
        "POST",
        f"/api/applications/{public_id}/receipt",
        file_path=ROOT / "demo" / "receipts" / "malicious_prompt_injection_receipt.pdf",
        token=alex["_demo_token"],
    )
    assert receipt["subscription"]["suspicious_content"] is True
    complete_safety(alex)
    submitted = call("POST", f"/api/applications/{public_id}/submit", token=alex["_demo_token"])
    assert submitted["application"]["status"] == "MANUAL_REVIEW"
    assert submitted["application"]["risk_level"] == "HIGH"

    reviewed = call(
        "POST",
        f"/api/admin/applications/{public_id}/approve",
        {
            "reason": "Reviewer verified the valid receipt fields; embedded text is inert.",
            "override_review_flag": True,
        },
    )
    assert reviewed["application"]["status"] == "APPROVED"
    payment = call("POST", f"/api/admin/applications/{public_id}/process-payment")
    assert payment["status"] == "PAID"
    print(f"ok manual review: {public_id} approved with audited override")


def guardrail_paths() -> None:
    users = reset()
    jamie = users["Jamie Lin"]
    duplicate_id = create_application(jamie, "Notion", "Notion AI")
    receipt = call(
        "POST",
        f"/api/applications/{duplicate_id}/receipt",
        file_path=ROOT / "demo" / "receipts" / "duplicate_receipt.pdf",
        token=jamie["_demo_token"],
    )
    assert receipt["duplicate_receipt"] is True
    complete_safety(jamie)
    duplicate = call(
        "POST",
        f"/api/applications/{duplicate_id}/submit",
        token=jamie["_demo_token"],
    )
    assert duplicate["application"]["status"] == "MANUAL_REVIEW"
    assert duplicate["application"]["risk_level"] == "HIGH"

    taylor = users["Taylor Wang"]
    age_id = create_application(taylor, "Anthropic", "Claude Pro")
    call(
        "POST",
        f"/api/applications/{age_id}/receipt",
        file_path=ROOT / "demo" / "receipts" / "claude_pro_valid.pdf",
        token=taylor["_demo_token"],
    )
    evaluation = call(
        "POST",
        f"/api/applications/{age_id}/eligibility/check",
        token=taylor["_demo_token"],
    )
    age_check = next(item for item in evaluation["checks"] if item["rule"] == "AGE_REQUIREMENT")
    assert age_check["passed"] is False

    stats = call("GET", "/api/admin/stats")
    assert stats["manual_review"] >= 1
    print(f"ok guardrails: duplicate {duplicate_id}; under-age {age_id}")


def main() -> None:
    health = call("GET", "/health")
    if health["status"] != "ok":
        raise SystemExit(f"Backend is not healthy: {health}")
    # Reset twice up front to exercise FK-safe, idempotent cleanup with the
    # seeded receipt/month claim reservations present after the first reset.
    reset()
    reset()
    happy_path()
    manual_review_path()
    guardrail_paths()
    print("all smoke scenarios passed")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, RuntimeError) as exc:
        print(f"smoke failure: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
