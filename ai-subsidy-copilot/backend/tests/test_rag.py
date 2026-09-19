import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import Application, PolicyDocument, SafetyModule
from app.rag.ingestion import sync_knowledge
from app.rag.retrieval import answer_policy_question
from app.services.demo import seed_demo_data


def test_chatgpt_query_retrieves_eligible_product_policy(db: Session) -> None:
    answer = answer_policy_question(db, "Is ChatGPT Plus eligible?")
    assert answer.established is True
    assert "Yes" in answer.answer
    assert any("Eligible" in citation.section for citation in answer.citations)


def test_claude_query_has_a_real_source(db: Session) -> None:
    answer = answer_policy_question(db, "Is Claude Pro eligible?")
    assert answer.established is True
    assert "Claude Pro" in answer.answer
    assert answer.citations


def test_unknown_provider_does_not_hallucinate_eligibility(db: Session) -> None:
    answer = answer_policy_question(db, "Is Gemini Advanced eligible?")
    assert answer.established is False
    assert "cannot establish" in answer.answer.lower()
    assert "yes" not in answer.answer.lower()


def test_product_name_extension_is_not_treated_as_exact_match(db: Session) -> None:
    answer = answer_policy_question(db, "Is ChatGPT Plus Enterprise eligible?")
    assert answer.established is False
    assert "cannot establish" in answer.answer.lower()
    assert "yes" not in answer.answer.lower()


@pytest.mark.parametrize(
    "query",
    [
        "Can I claim Midjourney?",
        "Can Midjourney be reimbursed?",
        "Can I apply with a Midjourney receipt?",
        "May I claim Midjourney?",
    ],
)
def test_claim_intent_for_unlisted_product_is_not_answered_from_unrelated_chunk(
    db: Session, query: str
) -> None:
    answer = answer_policy_question(db, query)
    assert answer.established is False
    assert "cannot establish" in answer.answer.lower()
    assert "midjourney" in answer.answer.lower()


@pytest.mark.parametrize(
    ("query", "product"),
    [
        ("Can ChatGPT Plus be reimbursed?", "ChatGPT Plus"),
        ("Can I apply with a Claude Pro receipt?", "Claude Pro"),
        ("May I claim Notion AI?", "Notion AI"),
    ],
)
def test_claim_intent_variants_still_establish_known_products(
    db: Session, query: str, product: str
) -> None:
    answer = answer_policy_question(db, query)
    assert answer.established is True
    assert product in answer.answer
    assert answer.citations


def test_meeting_notes_guidance_retrieves_privacy_material(db: Session) -> None:
    answer = answer_policy_question(
        db,
        "Can I paste company meeting notes into an AI assistant? Explain privacy, "
        "confidential information, authorization, and identifiers.",
    )
    assert answer.established is True
    assert "authorized" in answer.answer
    assert "Removing names alone" in answer.answer
    assert any("Privacy" in citation.document for citation in answer.citations)


def test_meeting_notes_guidance_reports_insufficient_material(db: Session) -> None:
    for document in db.scalars(select(PolicyDocument)).all():
        if "meeting notes" in document.content.lower():
            document.content = "Privacy: share only the minimum information needed."
    db.commit()
    answer = answer_policy_question(db, "What about company meeting notes and privacy?")
    assert answer.established is False
    assert answer.citations == []


def test_existing_demo_upgrades_learning_and_policy_without_reset(db: Session) -> None:
    document = next(
        row for row in db.scalars(select(PolicyDocument)).all()
        if row.metadata_json.get("article") == "Article 9"
    )
    document_id = document.id
    document.section = "Article 9 — AI Safety Training"
    document.content = "All four required modules must be completed before submission."
    document.content_hash = "legacy-safety-rule"
    for module in db.scalars(select(SafetyModule)).all():
        module.required = True
    application = db.scalar(select(Application))
    application_id = application.id
    recorded_decision = application.eligibility_reasons_json.copy()
    db.commit()

    seed_demo_data(db, ingest_policy=True)
    upgraded = db.get(PolicyDocument, document_id)
    assert "optional" in upgraded.content.lower()
    assert "required modules" not in upgraded.content
    assert all(not module.required for module in db.scalars(select(SafetyModule)).all())
    assert db.get(Application, application_id).eligibility_reasons_json == recorded_decision
    assert sync_knowledge(db, settings.knowledge_dir) == 0
    answer = answer_policy_question(db, "Can I submit before completing safety training?")
    assert answer.established is True
    assert "optional" in answer.answer
