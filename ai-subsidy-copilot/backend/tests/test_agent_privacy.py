from __future__ import annotations

import json

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentSession, Application
from app.services.demo import DEMO_USER_IDS


def test_agent_session_redacts_sensitive_chat_and_persists_minimal_state(
    client: TestClient, db: Session
) -> None:
    user_id = DEMO_USER_IDS["alex"]
    login = client.post("/api/demo/login", json={"user_id": str(user_id)})
    assert login.status_code == 200, login.text
    client.headers["Authorization"] = f"Bearer {login.json()['demo_token']}"
    created = client.post("/api/applications", json={"user_id": str(user_id)})
    assert created.status_code == 200, created.text
    public_id = created.json()["public_id"]

    sensitive_values = (
        "swordfish",
        "sk-test-secret-123456",
        "1234 5678 9012 3456",
        "A123456789",
        "private@example.test",
    )
    message = (
        "My password is swordfish. API key: sk-test-secret-123456. "
        "Bank account 1234 5678 9012 3456. National ID A123456789. "
        "Email private@example.test. Please help me continue."
    )
    response = client.post(
        "/api/agent/chat",
        json={"user_id": str(user_id), "application_id": public_id, "message": message},
    )
    assert response.status_code == 200, response.text

    application = db.scalar(select(Application).where(Application.public_id == public_id))
    assert application is not None
    session = db.scalar(select(AgentSession).where(AgentSession.application_id == application.id))
    assert session is not None
    persisted = json.dumps(
        {"messages": session.messages_json, "state": session.state_json},
        sort_keys=True,
    )
    for sensitive_value in sensitive_values:
        assert sensitive_value not in persisted
    assert "[REDACTED" in persisted
    assert "Please help me continue." in session.messages_json[0]["content"]
    assert {item["role"] for item in session.messages_json} == {"user", "assistant"}
    assert not {
        "user_id",
        "identity_verified",
        "receipt_id",
        "receipt_extracted",
        "policy_context",
        "eligibility_result",
    } & set(session.state_json)

    session.messages_json = [
        {
            "role": "user",
            "content": "Legacy password is oldsecret and email legacy@example.test.",
        }
    ]
    db.commit()
    follow_up = client.post(
        "/api/agent/chat",
        json={
            "user_id": str(user_id),
            "application_id": public_id,
            "message": "Please continue my application.",
        },
    )
    assert follow_up.status_code == 200, follow_up.text
    db.refresh(session)
    upgraded_history = json.dumps(session.messages_json)
    assert "oldsecret" not in upgraded_history
    assert "legacy@example.test" not in upgraded_history
    assert "[REDACTED" in upgraded_history
