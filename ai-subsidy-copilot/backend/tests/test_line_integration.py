from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from flow_helpers import REVIEWER, complete_application, install_ocr, login_as

from app.core.config import settings

KEY = {"X-Internal-Key": "bot-secret"}
LINE_USER = "Uabcdef1234567890"


@pytest.fixture(autouse=True)
def line_settings(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    monkeypatch.setattr(settings, "line_integration_secret", "bot-secret")
    monkeypatch.setattr(settings, "line_channel_access_token", "channel-token")
    pushed: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "app.services.line_notify._push", lambda user, text: pushed.append((user, text))
    )
    return pushed


def link(client: TestClient) -> str:
    response = client.post(
        "/api/internal/line/link-code", json={"line_user_id": LINE_USER}, headers=KEY
    )
    assert response.status_code == 200, response.text
    assert response.json()["url"].endswith(f"/apply?line_code={response.json()['code']}")
    return response.json()["code"]


def test_internal_api_requires_the_shared_secret(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    body = {"line_user_id": LINE_USER}
    assert client.post("/api/internal/line/link-code", json=body).status_code == 401
    wrong = client.post(
        "/api/internal/line/link-code", json=body, headers={"X-Internal-Key": "nope"}
    )
    assert wrong.status_code == 401
    monkeypatch.setattr(settings, "line_integration_secret", "")
    disabled = client.post(
        "/api/internal/line/link-code", json=body, headers={"X-Internal-Key": ""}
    )
    assert disabled.status_code == 401


def test_link_code_binds_once_and_expires_after_use(client: TestClient) -> None:
    code = link(client)
    login_as(client, "alex")
    assert client.post("/api/line/bind", json={"code": code}).status_code == 200
    again = client.post("/api/line/bind", json={"code": code})
    assert again.status_code == 400
    assert again.json()["error"]["code"] == "LINK_CODE_INVALID"
    assert client.post("/api/line/bind", json={"code": "does-not-exist"}).status_code == 400


def test_status_lookup_and_cancel_through_line(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_ocr(monkeypatch, "alex")
    code = link(client)
    public_id = complete_application(client, "alex")
    assert client.post("/api/line/bind", json={"code": code}).status_code == 200
    client.post(f"/api/applications/{public_id}/submit")

    listing = client.get(
        "/api/internal/line/applications", params={"line_user_id": LINE_USER}, headers=KEY
    ).json()["applications"]
    assert listing[0]["public_id"] == public_id
    assert listing[0]["status"] == "MANUAL_REVIEW"
    assert "審核" in listing[0]["status_label"]

    stranger = client.get(
        "/api/internal/line/applications", params={"line_user_id": "Uother"}, headers=KEY
    )
    assert stranger.json() == {"applications": []}

    cancelled = client.post(
        "/api/internal/line/cancel", json={"line_user_id": LINE_USER}, headers=KEY
    )
    assert cancelled.json() == {"cancelled": public_id}
    nothing = client.post(
        "/api/internal/line/cancel", json={"line_user_id": LINE_USER}, headers=KEY
    )
    assert nothing.json() == {"cancelled": None}


def test_workflow_steps_push_notifications_to_the_bound_account(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    line_settings: list[tuple[str, str]],
) -> None:
    install_ocr(monkeypatch, "alex")
    code = link(client)
    public_id = complete_application(client, "alex")
    client.post("/api/line/bind", json={"code": code})

    client.post(f"/api/applications/{public_id}/submit")
    client.headers.pop("Authorization")
    client.post(
        f"/api/admin/applications/{public_id}/approve",
        json={**REVIEWER, "reason": "文件核對無誤"},
    )
    client.post(f"/api/admin/applications/{public_id}/process-payment", json=REVIEWER)
    messages = [text for user, text in line_settings if user == LINE_USER]
    assert any("已送出" in text for text in messages)
    assert any("已核准" in text for text in messages)
    assert any("撥款" in text for text in messages)
    assert all(public_id in text for text in messages)


def test_reviewer_message_needs_a_bound_account(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    line_settings: list[tuple[str, str]],
) -> None:
    install_ocr(monkeypatch, "alex")
    public_id = complete_application(client, "alex")
    client.post(f"/api/applications/{public_id}/submit")
    client.headers.pop("Authorization")
    payload = {**REVIEWER, "message": "請補上更清楚的收據"}
    unbound = client.post(f"/api/admin/applications/{public_id}/notify", json=payload)
    assert unbound.status_code == 409
    assert unbound.json()["error"]["code"] == "LINE_NOT_AVAILABLE"

    code = link(client)
    login_as(client, "alex")
    client.post("/api/line/bind", json={"code": code})
    client.headers.pop("Authorization")
    sent = client.post(f"/api/admin/applications/{public_id}/notify", json=payload)
    assert sent.status_code == 200
    assert (LINE_USER, "請補上更清楚的收據") in line_settings


def test_push_failure_never_breaks_the_workflow(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(_user: str, _text: str) -> None:
        raise OSError("LINE is down")

    monkeypatch.setattr("app.services.line_notify._push", broken)
    install_ocr(monkeypatch, "alex")
    code = link(client)
    public_id = complete_application(client, "alex")
    client.post("/api/line/bind", json={"code": code})
    submitted = client.post(f"/api/applications/{public_id}/submit")
    assert submitted.status_code == 200
    assert submitted.json()["application"]["status"] == "MANUAL_REVIEW"
