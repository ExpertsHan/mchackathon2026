"""Deterministic orchestration around optional AI policy generation.

The workflow deliberately routes authority-bearing actions into domain services.
It can run fully offline and does not expose unrestricted model tool calling.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.state import AgentIntent, AgentState, PersistedAgentState, WorkflowStage
from app.agent.tools import (
    get_application,
    get_application_status,
    get_user_profile,
    run_eligibility,
    safety_progress,
    search_policy,
)
from app.core.config import settings
from app.core.enums import ActorType, ApplicationStatus
from app.core.errors import DomainError
from app.models import AgentSession
from app.schemas.api import AgentChatResponse, SuggestedAction
from app.services.applications import submit_application
from app.services.audit import record_audit

MAX_PERSISTED_MESSAGES = 8
MAX_PERSISTED_USER_CHARS = 1000
MAX_PERSISTED_ASSISTANT_CHARS = 2000

_CHAT_REDACTION_PATTERNS = (
    (
        re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
        "[REDACTED_EMAIL]",
    ),
    (
        re.compile(
            r"\b(?P<label>password|passcode|pin)\s*(?:is|[:=])\s*"
            r"(?P<secret>[^\s,;.!?]+)",
            re.IGNORECASE,
        ),
        r"\g<label> [REDACTED_CREDENTIAL]",
    ),
    (
        re.compile(
            r"\b(?P<label>api[\s_-]*key|access[\s_-]*token|secret[\s_-]*key)"
            r"\s*(?:is|[:=])\s*(?P<secret>[^\s,;.!?]+)",
            re.IGNORECASE,
        ),
        r"\g<label> [REDACTED_API_KEY]",
    ),
    (
        re.compile(r"\b(?:sk|rk|pk)-[A-Z0-9_-]{8,}\b", re.IGNORECASE),
        "[REDACTED_API_KEY]",
    ),
    (
        re.compile(
            r"\b(?P<label>(?:bank\s+)?account(?:\s+(?:number|no\.?))?|"
            r"routing(?:\s+(?:number|no\.?))?|card(?:\s+(?:number|no\.?))?)"
            r"\s*(?:is|[:=#-])?\s*(?P<secret>\d(?:[\s-]*\d){7,18})",
            re.IGNORECASE,
        ),
        r"\g<label> [REDACTED_FINANCIAL]",
    ),
    (
        re.compile(
            r"\b(?P<label>(?:national|government|tax)\s+id"
            r"(?:\s+(?:number|no\.?))?)\s*(?:is|[:=#-])?\s*"
            r"(?P<secret>[A-Z]?[A-Z0-9-]{7,20})",
            re.IGNORECASE,
        ),
        r"\g<label> [REDACTED_GOVERNMENT_ID]",
    ),
    (re.compile(r"\b[A-Z][12]\d{8}\b", re.IGNORECASE), "[REDACTED_GOVERNMENT_ID]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED_GOVERNMENT_ID]"),
    (re.compile(r"\b(?:\d[ -]?){12,18}\d\b"), "[REDACTED_FINANCIAL]"),
)


def _sanitize_chat_text(value: str, *, limit: int) -> str:
    sanitized = value[:limit]
    for pattern, replacement in _CHAT_REDACTION_PATTERNS:
        sanitized = pattern.sub(replacement, sanitized)
    return sanitized


def _sanitize_persisted_message(message: object) -> dict[str, str] | None:
    if not isinstance(message, dict):
        return None
    role = message.get("role")
    content = message.get("content")
    if role not in {"user", "assistant"} or not isinstance(content, str):
        return None
    limit = MAX_PERSISTED_USER_CHARS if role == "user" else MAX_PERSISTED_ASSISTANT_CHARS
    return {"role": role, "content": _sanitize_chat_text(content, limit=limit)}


def _persisted_state(state: AgentState) -> PersistedAgentState:
    return PersistedAgentState(
        intent=state.intent,
        stage=state.stage,
        provider=(
            _sanitize_chat_text(state.provider, limit=120) if state.provider is not None else None
        ),
        product=(
            _sanitize_chat_text(state.product, limit=120) if state.product is not None else None
        ),
        receipt_uploaded=bool(state.receipt_id or state.receipt_extracted),
        safety_complete=state.safety_complete,
        missing_fields=state.missing_fields,
        status=state.status,
    )


def _intent(message: str) -> AgentIntent:
    lowered = message.lower()
    if re.search(r"\b(submit|send my application|finish application)\b", lowered):
        return AgentIntent.SUBMIT
    if re.search(r"\b(status|track|paid|payment|where is my)\b", lowered):
        return AgentIntent.STATUS_LOOKUP
    if re.search(r"\b(chatgpt|claude|notion|gemini|product|service)\b", lowered) and re.search(
        r"\b(eligible|covered|policy|rule)\b", lowered
    ):
        return AgentIntent.FAQ
    if re.search(r"\b(eligible|eligibility|qualify|check my)\b", lowered):
        return AgentIntent.ELIGIBILITY
    if "?" in message or re.search(
        r"\b(policy|rule|deadline|how much|which product|chatgpt|claude|notion)\b", lowered
    ):
        return AgentIntent.FAQ
    return AgentIntent.APPLICATION_GUIDANCE


def _derive_state(db: Session, user_id: uuid.UUID, public_id: str | None) -> AgentState:
    profile = get_user_profile(db, user_id)
    state = AgentState(
        user_id=user_id,
        application_id=public_id,
        identity_verified=bool(profile["identity_verified"]),
    )
    if not public_id:
        state.stage = WorkflowStage.COLLECT_SUBSCRIPTION
        state.missing_fields = ["application"]
        return state
    application = get_application(db, public_id, user_id)
    state.status = application.status.value
    subscription = application.subscription
    if subscription:
        state.provider = subscription.provider
        state.product = subscription.product
        state.receipt_id = subscription.receipt_reference
        state.receipt_extracted = subscription.extraction_json or {}
    progress = safety_progress(db, user_id)
    state.safety_complete = progress.all_required_complete
    missing: list[str] = []
    if not subscription or not subscription.product:
        missing.append("subscription product")
    if not subscription or not subscription.receipt_hash:
        missing.append("receipt")
    if not state.safety_complete:
        missing.append("AI safety training")
    state.missing_fields = missing
    if application.status in {
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.VERIFYING,
        ApplicationStatus.APPROVED,
        ApplicationStatus.REJECTED,
        ApplicationStatus.PAYMENT_SCHEDULED,
        ApplicationStatus.PAID,
    }:
        state.stage = WorkflowStage.END
    elif application.status == ApplicationStatus.MANUAL_REVIEW:
        state.stage = WorkflowStage.MANUAL_REVIEW_REQUIRED
    elif not subscription or not subscription.product:
        state.stage = WorkflowStage.COLLECT_SUBSCRIPTION
    elif not subscription.receipt_hash:
        state.stage = WorkflowStage.COLLECT_RECEIPT
    elif not application.eligibility_result:
        state.stage = WorkflowStage.CHECK_ELIGIBILITY
    elif not state.safety_complete:
        state.stage = WorkflowStage.SAFETY_TRAINING
    else:
        state.stage = WorkflowStage.FINAL_REVIEW
    return state


def _save_session(
    db: Session, state: AgentState, user_message: str, assistant_message: str
) -> None:
    if not state.application_id:
        return
    application = get_application(db, state.application_id, state.user_id)
    session = db.scalar(select(AgentSession).where(AgentSession.application_id == application.id))
    if session is None:
        session = AgentSession(application_id=application.id)
        db.add(session)
    messages = [
        sanitized
        for message in (session.messages_json or [])
        if (sanitized := _sanitize_persisted_message(message)) is not None
    ]
    messages.extend(
        [
            {
                "role": "user",
                "content": _sanitize_chat_text(user_message, limit=MAX_PERSISTED_USER_CHARS),
            },
            {
                "role": "assistant",
                "content": _sanitize_chat_text(
                    assistant_message, limit=MAX_PERSISTED_ASSISTANT_CHARS
                ),
            },
        ]
    )
    session.messages_json = messages[-MAX_PERSISTED_MESSAGES:]
    session.state_json = _persisted_state(state).model_dump(mode="json")
    db.commit()


def chat(
    db: Session,
    *,
    user_id: uuid.UUID,
    public_id: str | None,
    message: str,
) -> AgentChatResponse:
    state = _derive_state(db, user_id, public_id)
    state.intent = _intent(message)
    citations = []
    actions: list[SuggestedAction] = []
    ai_used = False
    notice = None

    if state.intent == AgentIntent.FAQ:
        # Policy retrieval may call an external embedding/model provider. Strip
        # incidental secrets first while preserving the citizen's policy query.
        answer = search_policy(db, _sanitize_chat_text(message, limit=2000))
        response_text = answer.answer
        citations = answer.citations
        ai_used = answer.ai_used
        notice = answer.notice
        record_audit(
            db,
            action="POLICY_RETRIEVED",
            actor_type=ActorType.AI_AGENT,
            actor_identifier="ai-subsidy-copilot",
            application=get_application(db, public_id, user_id) if public_id else None,
            user_id=user_id,
            details={
                "retrieved_sources": [
                    {"document": item.document, "section": item.section} for item in citations
                ],
                "model": settings.openai_model if ai_used else None,
                "outcome": "answered" if answer.established else "not_established",
            },
        )
        db.commit()
    elif state.intent == AgentIntent.STATUS_LOOKUP:
        if not public_id:
            response_text = "Choose an application or enter its public application ID to track it."
            actions.append(SuggestedAction(type="link", label="Track application", href="/track"))
        else:
            status = get_application_status(db, public_id, user_id)
            response_text = f"Application {public_id} is currently {status['status']}."
            if status["transaction_id"]:
                response_text += f" Its mock payment transaction is {status['transaction_id']}."
            actions.append(
                SuggestedAction(
                    type="link", label="View timeline", href=f"/application/{public_id}"
                )
            )
    elif state.intent == AgentIntent.ELIGIBILITY and public_id:
        evaluation = run_eligibility(db, public_id, user_id)
        state.eligibility_result = evaluation.model_dump(mode="json")
        passed = sum(check.passed for check in evaluation.checks)
        response_text = (
            f"The deterministic rule engine passed {passed} of {len(evaluation.checks)} checks. "
            f"The current result is {evaluation.outcome.value}."
        )
        if evaluation.requires_manual_review:
            response_text += " This application requires human review."
        actions.append(
            SuggestedAction(
                type="link", label="Review eligibility", href=f"/application/{public_id}"
            )
        )
    elif state.intent == AgentIntent.SUBMIT and public_id:
        application = get_application(db, public_id, user_id)
        try:
            submit_application(db, application, actor_identifier=str(user_id))
            state = _derive_state(db, user_id, public_id)
            response_text = (
                f"Application {public_id} was submitted through the validated backend workflow. "
                f"Its current status is {state.status}."
            )
            actions.append(
                SuggestedAction(
                    type="link", label="Track application", href=f"/application/{public_id}"
                )
            )
        except DomainError as exc:
            response_text = exc.message
            if exc.code == "SAFETY_TRAINING_INCOMPLETE":
                actions.append(
                    SuggestedAction(type="link", label="Continue AI safety", href="/safety")
                )
    else:
        if state.stage == WorkflowStage.COLLECT_SUBSCRIPTION:
            response_text = "Which eligible AI service did you subscribe to?"
            actions.extend(
                SuggestedAction(type="quick_reply", label=product, value=product)
                for product in ("ChatGPT Plus", "Claude Pro", "Notion AI", "Other")
            )
        elif state.stage == WorkflowStage.COLLECT_RECEIPT:
            response_text = "Please upload your PDF, PNG, or JPEG subscription receipt."
            actions.append(SuggestedAction(type="upload_receipt", label="Upload receipt"))
        elif state.stage == WorkflowStage.CHECK_ELIGIBILITY:
            response_text = "Your receipt is ready. Run the deterministic eligibility check next."
            actions.append(SuggestedAction(type="check_eligibility", label="Check eligibility"))
        elif state.stage == WorkflowStage.SAFETY_TRAINING:
            response_text = "Complete all four short AI Safety Training modules before submission."
            actions.append(SuggestedAction(type="link", label="Continue training", href="/safety"))
        elif state.stage == WorkflowStage.FINAL_REVIEW:
            response_text = "All required information is ready. Review and submit your application."
            actions.append(SuggestedAction(type="submit", label="Submit application"))
        elif state.stage == WorkflowStage.MANUAL_REVIEW_REQUIRED:
            response_text = (
                "This application requires human review. Check its timeline for the reason."
            )
        else:
            response_text = f"Application {public_id} is {state.status}. You can view its timeline."
            if public_id:
                actions.append(
                    SuggestedAction(
                        type="link", label="View timeline", href=f"/application/{public_id}"
                    )
                )

    _save_session(db, state, message, response_text)
    return AgentChatResponse(
        message=response_text,
        citations=citations,
        suggested_actions=actions,
        agent_state=state.model_dump(mode="json"),
        ai_used=ai_used,
        notice=notice,
    )
