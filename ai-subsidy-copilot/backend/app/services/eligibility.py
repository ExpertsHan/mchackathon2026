"""Eligibility view of the OCR rule engine's RULE-001~020 evaluation.

The OCR engine (``ocr/rules.js``) decides eligibility and the subsidy amount. This
module only maps its five-valued verdict onto Copilot's workflow vocabulary. It never
approves anything: every submitted case is routed to a human reviewer.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import ActorType, EligibilityOutcome, RiskLevel
from app.models import Application, SourceReview
from app.rag.embeddings import openai_embeddings_configured
from app.rag.retrieval import search_policy
from app.schemas import EligibilityCheck, EligibilityEvaluation
from app.services.audit import record_audit

# ai-backend result -> (Copilot outcome, risk level). The application status that follows
# is decided by submit_application: NEED_SUPPLEMENT asks the citizen for documents,
# everything else waits in the human review queue.
RESULT_MAPPING: dict[str, tuple[EligibilityOutcome, RiskLevel]] = {
    "PASS": (EligibilityOutcome.ELIGIBLE, RiskLevel.LOW),
    "NEED_SUPPLEMENT": (EligibilityOutcome.MANUAL_REVIEW, RiskLevel.MEDIUM),
    "REVIEW": (EligibilityOutcome.MANUAL_REVIEW, RiskLevel.MEDIUM),
    "REJECT": (EligibilityOutcome.INELIGIBLE, RiskLevel.MEDIUM),
    "FRAUD_RISK": (EligibilityOutcome.MANUAL_REVIEW, RiskLevel.HIGH),
}
BLOCKING_RESULTS = {"REJECT", "FRAUD_RISK"}
MANUAL_RESULTS = {"REVIEW", "NEED_SUPPLEMENT", "FRAUD_RISK"}


def quantize_twd(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def subsidy_amount(evaluation: dict) -> Decimal | None:
    """Trial subsidy in TWD, or None when the engine could not establish an amount."""

    subsidy = evaluation.get("subsidy") or {}
    if subsidy.get("unknown") or subsidy.get("subsidy_amount") is None:
        return None
    return quantize_twd(subsidy["subsidy_amount"])


def evaluation_from_review(evaluation: dict) -> EligibilityEvaluation | None:
    result = evaluation.get("result")
    if result not in RESULT_MAPPING:
        return None
    outcome, risk = RESULT_MAPPING[result]
    rules = evaluation.get("rules") or []
    checks = [
        EligibilityCheck(
            rule=rule["id"],
            name=rule.get("name"),
            passed=not rule.get("result"),
            message=rule.get("reason") or "",
            blocking=rule.get("result") in BLOCKING_RESULTS,
            requires_manual_review=rule.get("result") in MANUAL_RESULTS,
            result=rule.get("result"),
        )
        for rule in rules
    ]
    reasons = [f"[{rule['id']}] {rule.get('reason', '')}" for rule in rules if rule.get("result")]
    estimate = subsidy_amount(evaluation)
    return EligibilityEvaluation(
        eligible=result == "PASS",
        provisionally_eligible=False,
        # Nothing is auto-approved, so every evaluated case needs a human decision.
        requires_manual_review=True,
        outcome=outcome,
        approved_amount_twd=Decimal("0.00"),
        estimated_amount_twd=estimate or Decimal("0.00"),
        checks=checks,
        risk_level=risk,
        risk_reasons=reasons,
        ai_result=result,
    )


def evaluate_application(
    db: Session,
    application: Application,
    *,
    persist: bool = True,
) -> EligibilityEvaluation | None:
    """Evaluate with the OCR engine (persist=True) or read the stored verdict."""

    from app.services.source_review import analyze_sources

    review = db.get(SourceReview, application.id)
    if review is None or not review.documents_required:
        return None
    evaluation = analyze_sources(db, application) if persist else review.evaluation
    result = evaluation_from_review(evaluation)
    if result is None:
        return None
    if persist:
        _record_policy_context(db, application)
        application.eligibility_result = result.outcome
        application.eligibility_reasons_json = [
            check.model_dump(mode="json") for check in result.checks
        ]
        application.risk_level = result.risk_level
        application.risk_reasons_json = result.risk_reasons
        # Trial amount only: approved_amount_twd is written when a reviewer approves.
        application.requested_amount_twd = result.estimated_amount_twd
        record_audit(
            db,
            "ELIGIBILITY_EVALUATED",
            ActorType.RULE_ENGINE,
            "ocr-rules-v1",
            application=application,
            details={
                "ai_result": result.ai_result,
                "outcome": result.outcome,
                "risk_level": result.risk_level,
                "estimated_amount_twd": result.estimated_amount_twd,
            },
        )
    return result


def _record_policy_context(db: Session, application: Application) -> None:
    """Attach retrieved policy passages so reviewers can read the governing text."""

    results = search_policy(
        db, "What evidence and eligibility rules apply to a subsidy application?", top_k=4
    )
    application.policy_citations_json = [
        result.citation.model_dump(mode="json") for result in results
    ]
    record_audit(
        db,
        "POLICY_RETRIEVED",
        ActorType.RULE_ENGINE,
        "policy-retrieval-v1",
        application=application,
        details={
            "tool": "search_policy",
            "model": (
                settings.openai_embedding_model
                if openai_embeddings_configured()
                else "deterministic-lexical-v1"
            ),
            "chunks": [
                {
                    "id": result.id,
                    "document": result.citation.document,
                    "section": result.citation.section,
                    "version": result.citation.version,
                }
                for result in results
            ],
            "outcome": "retrieved" if results else "not_established",
        },
    )
