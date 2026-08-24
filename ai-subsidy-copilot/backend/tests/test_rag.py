import pytest
from sqlalchemy.orm import Session

from app.rag.retrieval import answer_policy_question


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
