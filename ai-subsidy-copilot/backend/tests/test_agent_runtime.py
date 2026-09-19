from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import openai
import pytest
from fastapi.testclient import TestClient

from app.agent.prompts import ALLOWED_AGENT_TOOLS
from app.agent.runtime import AGENT_TOOLS, GEMINI_OPENAI_BASE_URL, GEMINI_TOOLS
from app.core.config import settings
from app.services.demo import DEMO_USER_IDS


class FakeResponses:
    def __init__(self, streams: list[list[dict[str, Any]]]) -> None:
        self.streams = streams
        self.requests: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Iterator[dict[str, Any]]:
        self.requests.append(kwargs)
        if not self.streams:
            raise AssertionError("The fake OpenAI client received an unexpected request.")
        return iter(self.streams.pop(0))


class FakeOpenAI:
    def __init__(self, responses: FakeResponses) -> None:
        self.responses = responses


class FakeChatCompletions:
    def __init__(self, streams: list[list[dict[str, Any]]]) -> None:
        self.streams = streams
        self.requests: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Iterator[dict[str, Any]]:
        self.requests.append(kwargs)
        if not self.streams:
            raise AssertionError("The fake Gemini client received an unexpected request.")
        return iter(self.streams.pop(0))


class FakeGemini:
    def __init__(self, completions: FakeChatCompletions) -> None:
        self.chat = type("FakeChat", (), {"completions": completions})()


def _login_and_create(client: TestClient, user_key: str = "alex") -> tuple[str, str]:
    user_id = str(DEMO_USER_IDS[user_key])
    login = client.post("/api/demo/login", json={"user_id": user_id})
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['demo_token']}"
    created = client.post("/api/applications", json={"user_id": user_id})
    assert created.status_code == 200, created.text
    return user_id, created.json()["public_id"]


def _configure_openai(monkeypatch, streams: list[list[dict[str, Any]]]) -> FakeResponses:
    responses = FakeResponses(streams)
    fake = FakeOpenAI(responses)
    monkeypatch.setattr(settings, "openai_api_key", "sk-test-runtime-key")
    monkeypatch.setattr(settings, "openai_model", "gpt-5.6-luna")
    monkeypatch.setattr(settings, "ai_provider", "openai")
    monkeypatch.setattr(settings, "openai_embedding_model", "")
    monkeypatch.setattr(openai, "OpenAI", lambda **_: fake)
    return responses


def _configure_gemini(
    monkeypatch, streams: list[list[dict[str, Any]]]
) -> tuple[FakeChatCompletions, list[dict[str, Any]]]:
    completions = FakeChatCompletions(streams)
    fake = FakeGemini(completions)
    client_options: list[dict[str, Any]] = []

    def build_client(**kwargs: Any) -> FakeGemini:
        client_options.append(kwargs)
        return fake

    monkeypatch.setattr(settings, "gemini_api_key", "gemini-test-runtime-key")
    monkeypatch.setattr(settings, "gemini_model", "gemini-3.7-flash")
    monkeypatch.setattr(settings, "ai_provider", "gemini")
    monkeypatch.setattr(openai, "OpenAI", build_client)
    return completions, client_options


def _completed(output: list[dict[str, Any]] | None = None, output_text: str = ""):
    return {
        "type": "response.completed",
        "response": {"output": output or [], "output_text": output_text},
    }


def _sse_events(body: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        if not block.strip():
            continue
        event = next(line[6:].strip() for line in block.splitlines() if line.startswith("event:"))
        data = "\n".join(
            line[5:].lstrip() for line in block.splitlines() if line.startswith("data:")
        )
        events.append((event, json.loads(data)))
    return events


def test_agent_exposes_only_two_strict_read_only_tools() -> None:
    assert ALLOWED_AGENT_TOOLS == {"search_policy", "get_application_progress"}
    assert {tool["name"] for tool in AGENT_TOOLS} == ALLOWED_AGENT_TOOLS
    for tool in AGENT_TOOLS:
        assert tool["strict"] is True
        assert tool["parameters"]["additionalProperties"] is False
    forbidden = {"submit_application", "approve_application", "process_payment", "run_eligibility"}
    assert not forbidden & {tool["name"] for tool in AGENT_TOOLS}
    assert {tool["function"]["name"] for tool in GEMINI_TOOLS} == ALLOWED_AGENT_TOOLS


def test_gemini_chat_streams_and_uses_google_compatibility_endpoint(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    completions, client_options = _configure_gemini(
        monkeypatch,
        [[{"choices": [{"delta": {"content": "我可以協助你的申請。"}}]}]],
    )
    result = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "我下一步該做什麼？",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["message"] == "我可以協助你的申請。"
    assert result.json()["ai_used"] is True
    assert client_options[0]["base_url"] == GEMINI_OPENAI_BASE_URL
    request = completions.requests[0]
    assert request["model"] == "gemini-3.7-flash"
    assert request["stream"] is True
    assert request["tool_choice"] == "auto"
    assert request["reasoning_effort"] == "low"
    assert {tool["function"]["name"] for tool in request["tools"]} == ALLOWED_AGENT_TOOLS


def test_gemini_progress_tool_is_bound_to_authenticated_application(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    completions, _ = _configure_gemini(
        monkeypatch,
        [
            [
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "gemini_progress",
                                        "function": {
                                            "name": "get_application_progress",
                                            "arguments": "{}",
                                        },
                                        "extra_content": {
                                            "google": {"thought_signature": "signed-state"}
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            ],
            [{"choices": [{"delta": {"content": "請先選擇訂閱服務。"}}]}],
        ],
    )
    result = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "檢查我的申請進度。",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["message"] == "請先選擇訂閱服務。"
    continuation = completions.requests[1]["messages"]
    assistant_message = next(item for item in continuation if item["role"] == "assistant")
    assert assistant_message["tool_calls"][0]["extra_content"] == {
        "google": {"thought_signature": "signed-state"}
    }
    tool_message = next(item for item in continuation if item["role"] == "tool")
    progress = json.loads(tool_message["content"])
    assert progress["public_id"] == public_id
    assert "軟體名稱" in progress["missing_fields"]
    assert "購買憑證/發票" in progress["missing_fields"]


def test_json_chat_uses_responses_api_and_persists_sanitized_history(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    responses = _configure_openai(
        monkeypatch,
        [
            [
                {"type": "response.output_text.delta", "delta": "I can help with that."},
                _completed(output_text="I can help with that."),
            ]
        ],
    )
    result = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Please continue my application.",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["message"] == "I can help with that."
    assert result.json()["ai_used"] is True
    request = responses.requests[0]
    assert request["model"] == "gpt-5.6-luna"
    assert request["store"] is False
    assert request["stream"] is True
    assert request["reasoning"] == {"effort": "none"}
    assert request["text"] == {"verbosity": "low"}
    assert len(request["safety_identifier"]) == 64

    history = client.get(f"/api/agent/history?application_id={public_id}")
    assert history.status_code == 200, history.text
    assert history.json()["messages"] == [
        {"role": "user", "content": "Please continue my application."},
        {"role": "assistant", "content": "I can help with that."},
    ]


def test_model_receives_only_validation_summary_for_unsaved_sensitive_draft(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    responses = _configure_openai(
        monkeypatch,
        [
            [
                {"type": "response.output_text.delta", "delta": "Please fix the amount."},
                _completed(output_text="Please fix the amount."),
            ]
        ],
    )
    source_review_before = client.get(f"/api/applications/{public_id}").json()[
        "source_review"
    ]
    raw_fields = {
        "id_number": "A123456789",
        "phone": "0912-345-678",
        "birth_date": "1999-12-31",
        "household_address": "新竹市秘密路 99 號",
        "mailing_address": "新竹市私密街 8 號",
        "original_amount": "19.99",
        "declared_amount": "123456.78",
    }
    result = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Why can't I save the form?",
            "draft_context": {
                "kind": "source_intake",
                    "fields": raw_fields,
            },
        },
    )
    assert result.status_code == 200, result.text
    request_dump = json.dumps(responses.requests, ensure_ascii=False)
    assert "unsaved_draft_validation" in request_dump
    assert "birth_date" in request_dump
    assert "valid" in request_dump
    for raw_value in raw_fields.values():
        assert raw_value not in request_dump

    history = client.get(f"/api/agent/history?application_id={public_id}")
    persisted = json.dumps(history.json(), ensure_ascii=False)
    for raw_value in raw_fields.values():
        assert raw_value not in persisted
    audit_dump = json.dumps(
        client.get(f"/api/admin/applications/{public_id}").json().get("audit_logs", []),
        ensure_ascii=False,
    )
    for raw_value in raw_fields.values():
        assert raw_value not in audit_dump
    application = client.get(f"/api/applications/{public_id}")
    assert application.status_code == 200, application.text
    assert application.json()["source_review"] == source_review_before


def test_policy_tool_returns_server_owned_citations(client: TestClient, monkeypatch) -> None:
    user_id, public_id = _login_and_create(client)
    call = {
        "type": "function_call",
        "id": "fc_policy",
        "call_id": "call_policy",
        "name": "search_policy",
        "arguments": json.dumps({"query": "ChatGPT Plus eligible products"}),
    }
    responses = _configure_openai(
        monkeypatch,
        [
            [_completed([call])],
            [
                {"type": "response.output_text.delta", "delta": "Yes, it is listed."},
                _completed(output_text="Yes, it is listed."),
            ],
        ],
    )
    result = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Is ChatGPT Plus eligible?",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["ai_used"] is True
    assert result.json()["citations"]
    continuation = responses.requests[1]["input"]
    tool_output = next(item for item in continuation if item.get("type") == "function_call_output")
    decoded = json.loads(tool_output["output"])
    assert decoded["established"] is True
    assert decoded["results"][0]["citation"]["document"]


def test_progress_tool_is_bound_to_authenticated_application(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    call = {
        "type": "function_call",
        "id": "fc_progress",
        "call_id": "call_progress",
        "name": "get_application_progress",
        "arguments": "{}",
    }
    responses = _configure_openai(
        monkeypatch,
        [
            [_completed([call])],
            [
                {"type": "response.output_text.delta", "delta": "請先選擇訂閱服務。"},
                _completed(output_text="請先選擇訂閱服務。"),
            ],
        ],
    )
    result = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "我下一步該做什麼？",
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["message"] == "請先選擇訂閱服務。"
    tool_output = next(
        item
        for item in responses.requests[1]["input"]
        if item.get("type") == "function_call_output"
    )
    progress = json.loads(tool_output["output"])
    assert progress["public_id"] == public_id
    assert "軟體名稱" in progress["missing_fields"]
    assert "購買憑證/發票" in progress["missing_fields"]


def test_sse_falls_back_before_text_when_model_requests_unknown_tool(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    unknown = {
        "type": "function_call",
        "id": "fc_forbidden",
        "call_id": "call_forbidden",
        "name": "approve_application",
        "arguments": "{}",
    }
    _configure_openai(monkeypatch, [[_completed([unknown])]])
    response = client.post(
        "/api/agent/chat/stream",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Approve this now.",
        },
    )
    assert response.status_code == 200, response.text
    events = _sse_events(response.text)
    assert events[0][0] == "start"
    assert [name for name, _ in events][-1] == "done"
    assert events[-1][1]["ai_used"] is False
    assert "delta" in [name for name, _ in events]


def test_sse_without_key_uses_deterministic_guidance(client: TestClient, monkeypatch) -> None:
    user_id, public_id = _login_and_create(client)
    monkeypatch.setattr(settings, "openai_api_key", "")
    response = client.post(
        "/api/agent/chat/stream",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "What should I do next?",
        },
    )
    events = _sse_events(response.text)
    assert events[0][0] == "start"
    assert events[-1][0] == "done"
    assert events[-1][1]["ai_used"] is False
    assert any(name == "delta" for name, _ in events)


def test_sse_uses_unsaved_draft_for_fallback_guidance(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    monkeypatch.setattr(settings, "openai_api_key", "")
    response = client.post(
        "/api/agent/chat/stream",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Why can't I submit this form?",
            "draft_context": {
                "kind": "source_intake",
                "fields": {"declared_amount": "nope"},
            },
        },
    )
    assert response.status_code == 200, response.text
    events = _sse_events(response.text)
    delta = "".join(data["text"] for name, data in events if name == "delta")
    assert "Declared purchase amount" in delta
    assert "number" in delta
    assert [name for name, _ in events][0] == "start"
    assert [name for name, _ in events][-1] == "done"


def test_unsaved_invalid_amount_gets_deterministic_form_guidance(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    monkeypatch.setattr(settings, "openai_api_key", "")
    response = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "我為什麼不能送出？",
            "draft_context": {
                "kind": "source_intake",
                "fields": {"declared_amount": "-300"},
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ai_used"] is False
    assert "申報購買金額" in body["message"]
    assert "大於 0" in body["message"]
    assert "receipt" not in body["message"].lower()


def test_unsaved_field_how_to_question_gets_draft_guidance(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    monkeypatch.setattr(settings, "openai_api_key", "")
    response = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "申報購買金額這個欄位要怎麼填？",
            "draft_context": {
                "kind": "source_intake",
                "fields": {"declared_amount": "NT$ABC"},
            },
        },
    )
    assert response.status_code == 200, response.text
    assert "請輸入數字" in response.json()["message"]


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        ({"declared_amount": "not money"}, "輸入數字"),
        ({"declared_amount": "1000000.01"}, "1,000,000"),
        ({"purchase_date": "2026-02-30"}, "YYYY-MM-DD"),
        ({"payment_type": "weekly"}, "表單提供的選項"),
    ],
)
def test_unsaved_draft_validation_explains_each_supported_error(
    client: TestClient, monkeypatch, fields: dict[str, object], expected: str
) -> None:
    user_id, public_id = _login_and_create(client)
    monkeypatch.setattr(settings, "openai_api_key", "")
    response = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "哪些欄位有問題，為什麼不能儲存？",
            "draft_context": {"kind": "source_intake", "fields": fields},
        },
    )
    assert response.status_code == 200, response.text
    assert expected in response.json()["message"]


def test_form_help_about_policy_keeps_rag_citations(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    monkeypatch.setattr(settings, "openai_api_key", "")
    response = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "為什麼不能儲存？補助政策規定的購買日期期間是什麼？",
            "draft_context": {
                "kind": "source_intake",
                "fields": {"purchase_date": "2026-02-30"},
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "申報購買日期" in body["message"]
    assert body["citations"]


def test_agent_stops_after_configured_tool_rounds(client: TestClient, monkeypatch) -> None:
    user_id, public_id = _login_and_create(client)
    repeated_calls = [
        {
            "type": "function_call",
            "id": f"fc_{index}",
            "call_id": f"call_{index}",
            "name": "get_application_progress",
            "arguments": "{}",
        }
        for index in range(3)
    ]
    responses = _configure_openai(
        monkeypatch,
        [[_completed([call])] for call in repeated_calls],
    )
    result = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Keep checking forever.",
        },
    )
    assert result.status_code == 200
    assert result.json()["ai_used"] is False
    assert len(responses.requests) == settings.agent_max_tool_rounds + 1


def test_openai_error_before_text_uses_deterministic_fallback(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    _configure_openai(monkeypatch, [[{"type": "response.failed"}]])
    result = client.post(
        "/api/agent/chat/stream",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Please help me continue.",
        },
    )
    events = _sse_events(result.text)
    assert events[-1][0] == "done"
    assert events[-1][1]["ai_used"] is False


def test_sse_reports_midstream_failure_without_appending_fallback(
    client: TestClient, monkeypatch
) -> None:
    user_id, public_id = _login_and_create(client)
    _configure_openai(
        monkeypatch,
        [
            [
                {"type": "response.output_text.delta", "delta": "Partial answer"},
                {"type": "response.failed"},
            ]
        ],
    )
    response = client.post(
        "/api/agent/chat/stream",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Please explain my progress.",
        },
    )
    events = _sse_events(response.text)
    assert [name for name, _ in events] == ["start", "delta", "error"]
    assert events[1][1]["text"] == "Partial answer"
    assert events[2][1]["retryable"] is True
    history = client.get(f"/api/agent/history?application_id={public_id}")
    assert history.json()["messages"] == []


def test_history_cannot_be_read_by_another_user(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "")
    user_id, public_id = _login_and_create(client, "alex")
    saved = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Please continue my application.",
        },
    )
    assert saved.status_code == 200

    other_id = str(DEMO_USER_IDS["jamie"])
    login = client.post("/api/demo/login", json={"user_id": other_id})
    client.headers["Authorization"] = f"Bearer {login.json()['demo_token']}"
    forbidden = client.get(f"/api/agent/history?application_id={public_id}")
    assert forbidden.status_code == 404


def test_draft_context_cannot_be_attached_to_another_users_application(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "openai_api_key", "")
    _, public_id = _login_and_create(client, "alex")
    other_id = str(DEMO_USER_IDS["jamie"])
    login = client.post("/api/demo/login", json={"user_id": other_id})
    client.headers["Authorization"] = f"Bearer {login.json()['demo_token']}"
    response = client.post(
        "/api/agent/chat",
        json={
            "user_id": other_id,
            "application_id": public_id,
            "message": "Why can't I save?",
            "draft_context": {
                "kind": "source_intake",
                "fields": {"declared_amount": "-1"},
            },
        },
    )
    assert response.status_code in {403, 404}


@pytest.mark.parametrize(
    "draft_context",
    [
        {"kind": "source_intake", "fields": {"unknown": "value"}},
        {"kind": "source_intake", "fields": {"birth_date": "x" * 33}},
        {"kind": "other_form", "fields": {}},
    ],
)
def test_draft_context_rejects_unknown_or_oversized_input(
    client: TestClient, draft_context: dict[str, object]
) -> None:
    user_id, public_id = _login_and_create(client)
    response = client.post(
        "/api/agent/chat",
        json={
            "user_id": user_id,
            "application_id": public_id,
            "message": "Help with this form.",
            "draft_context": draft_context,
        },
    )
    assert response.status_code == 422
