"""Deterministic policy evaluation, isolated from LLM/RAG reasoning."""

from __future__ import annotations

import uuid
from calendar import monthrange
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from pydantic import ValidationError
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import (
    ActorType,
    ApplicationStatus,
    EligibilityOutcome,
    EligibilityRule,
)
from app.models import Application, SafetyModule, SafetyProgress, Subscription
from app.rag.embeddings import openai_embeddings_configured
from app.rag.retrieval import search_policy
from app.schemas import EligibilityCheck, EligibilityEvaluation, EligibilityInput
from app.schemas.receipt import ReceiptExtraction
from app.services.audit import record_audit
from app.services.claim_reservations import reserve_claim_keys
from app.services.risk import assess_risk

ELIGIBLE_PRODUCTS: dict[str, tuple[str, frozenset[str]]] = {
    "chatgpt plus": ("ChatGPT Plus", frozenset({"openai"})),
    "claude pro": ("Claude Pro", frozenset({"anthropic", "claude"})),
    "notion ai": ("Notion AI", frozenset({"notion", "notion labs"})),
}
ACTIVE_CLAIM_STATUSES = frozenset(
    {
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.VERIFYING,
        ApplicationStatus.MANUAL_REVIEW,
        ApplicationStatus.APPROVED,
        ApplicationStatus.PAYMENT_SCHEDULED,
        ApplicationStatus.PAID,
    }
)
MONTHLY_ALLOWANCE_STATUSES = frozenset(
    {
        ApplicationStatus.APPROVED,
        ApplicationStatus.PAYMENT_SCHEDULED,
        ApplicationStatus.PAID,
    }
)


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


def convert_to_twd(amount: Decimal, currency: str) -> Decimal:
    code = currency.strip().upper()
    rate = settings.mock_exchange_rates.get(code)
    if rate is None:
        raise ValueError(f"Unsupported demo currency: {code}")
    return (Decimal(amount) * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_subsidy(amount_twd: Decimal | None) -> Decimal:
    if amount_twd is None or amount_twd <= 0:
        return Decimal("0.00")
    return min(Decimal(amount_twd), settings.maximum_subsidy_twd).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


def evaluate_eligibility(data: EligibilityInput) -> EligibilityEvaluation:
    checks: list[EligibilityCheck] = []

    if data.age is None:
        checks.append(
            EligibilityCheck(
                rule=EligibilityRule.AGE_REQUIREMENT,
                passed=False,
                message="Applicant age could not be established.",
                blocking=True,
                requires_manual_review=True,
            )
        )
    elif data.age >= 18:
        checks.append(
            EligibilityCheck(
                rule=EligibilityRule.AGE_REQUIREMENT,
                passed=True,
                message=f"Applicant is {data.age}, meeting the minimum age of 18.",
            )
        )
    else:
        checks.append(
            EligibilityCheck(
                rule=EligibilityRule.AGE_REQUIREMENT,
                passed=False,
                message=f"Applicant is {data.age}; the minimum age is 18.",
                blocking=True,
            )
        )

    checks.append(
        EligibilityCheck(
            rule=EligibilityRule.IDENTITY_VERIFIED,
            passed=data.identity_verified,
            message=(
                "Demo identity verification is complete."
                if data.identity_verified
                else "Demo identity verification is required."
            ),
            blocking=not data.identity_verified,
        )
    )

    product_key = _normalize(data.product)
    product_rule = ELIGIBLE_PRODUCTS.get(product_key)
    product_known = product_rule is not None
    provider_key = _normalize(data.provider)
    provider_consistent = bool(product_rule and provider_key in product_rule[1])
    if product_rule and provider_consistent:
        product_message = f"{product_rule[0]} is an eligible AI subscription."
        product_passed = True
        product_manual = False
    elif product_rule and not data.provider:
        product_message = f"{product_rule[0]} is eligible, but the receipt provider is missing."
        product_passed = False
        product_manual = True
    elif product_rule:
        product_message = "The provider and eligible product do not match."
        product_passed = False
        product_manual = True
    else:
        product_message = "The product is not established as eligible under the demo policy."
        product_passed = False
        product_manual = True
    checks.append(
        EligibilityCheck(
            rule=EligibilityRule.ELIGIBLE_PRODUCT,
            passed=product_passed,
            message=product_message,
            blocking=not product_passed,
            requires_manual_review=product_manual,
        )
    )

    if data.purchase_date is None:
        date_check = EligibilityCheck(
            rule=EligibilityRule.VALID_PURCHASE_DATE,
            passed=False,
            message="The receipt date could not be determined.",
            blocking=True,
            requires_manual_review=True,
        )
    elif settings.program_effective_from <= data.purchase_date <= settings.program_effective_to:
        date_check = EligibilityCheck(
            rule=EligibilityRule.VALID_PURCHASE_DATE,
            passed=True,
            message=(
                f"Receipt date {data.purchase_date.isoformat()} is inside the 2026 demo period."
            ),
        )
    else:
        date_check = EligibilityCheck(
            rule=EligibilityRule.VALID_PURCHASE_DATE,
            passed=False,
            message=(
                f"Receipt date {data.purchase_date.isoformat()} is outside the 2026 demo period."
            ),
            blocking=True,
        )
    checks.append(date_check)

    if not data.receipt_hash:
        receipt_check = EligibilityCheck(
            rule=EligibilityRule.RECEIPT_NOT_DUPLICATED,
            passed=False,
            message="A receipt fingerprint is required for duplicate checking.",
            blocking=True,
            requires_manual_review=True,
        )
    elif data.duplicate_receipt:
        receipt_check = EligibilityCheck(
            rule=EligibilityRule.RECEIPT_NOT_DUPLICATED,
            passed=False,
            message="This receipt fingerprint was used by another active application.",
            blocking=True,
            requires_manual_review=True,
        )
    else:
        receipt_check = EligibilityCheck(
            rule=EligibilityRule.RECEIPT_NOT_DUPLICATED,
            passed=True,
            message="No active application using this receipt fingerprint was found.",
        )
    checks.append(receipt_check)

    checks.append(
        EligibilityCheck(
            rule=EligibilityRule.MONTHLY_LIMIT,
            passed=not data.monthly_claim_exists,
            message=(
                "No successful subsidy claim was found for this calendar month."
                if not data.monthly_claim_exists
                else "The monthly subsidy allowance has already been used."
            ),
            blocking=data.monthly_claim_exists,
            requires_manual_review=data.monthly_claim_exists,
        )
    )

    checks.append(
        EligibilityCheck(
            rule=EligibilityRule.SAFETY_TRAINING_COMPLETED,
            passed=data.safety_complete,
            message=(
                "All required AI safety modules are complete."
                if data.safety_complete
                else "All required AI safety modules must be completed before submission."
            ),
            blocking=not data.safety_complete,
        )
    )

    risk = assess_risk(
        data,
        product_known=product_known,
        provider_consistent=provider_consistent,
    )
    check_manual = any(check.requires_manual_review for check in checks)
    requires_manual_review = risk.requires_manual_review or check_manual
    all_passed = all(check.passed for check in checks)
    amount_valid = data.amount_twd is not None and data.amount_twd > 0
    eligible = all_passed and amount_valid and not requires_manual_review
    only_safety_missing = (
        not data.safety_complete
        and amount_valid
        and not requires_manual_review
        and all(
            check.passed
            for check in checks
            if check.rule is not EligibilityRule.SAFETY_TRAINING_COMPLETED
        )
    )

    if eligible:
        outcome = EligibilityOutcome.ELIGIBLE
    elif only_safety_missing:
        outcome = EligibilityOutcome.PROVISIONALLY_ELIGIBLE
    elif requires_manual_review:
        outcome = EligibilityOutcome.MANUAL_REVIEW
    else:
        outcome = EligibilityOutcome.INELIGIBLE

    estimated = calculate_subsidy(data.amount_twd)
    return EligibilityEvaluation(
        eligible=eligible,
        provisionally_eligible=only_safety_missing,
        requires_manual_review=requires_manual_review,
        outcome=outcome,
        approved_amount_twd=estimated if eligible else Decimal("0.00"),
        estimated_amount_twd=estimated,
        checks=checks,
        risk_level=risk.level,
        risk_reasons=risk.reasons,
    )


def safety_training_complete(db: Session, user_id: uuid.UUID) -> bool:
    required_count = (
        db.scalar(select(func.count(SafetyModule.id)).where(SafetyModule.required.is_(True))) or 0
    )
    completed_count = (
        db.scalar(
            select(func.count(SafetyProgress.id))
            .join(SafetyModule, SafetyProgress.module_id == SafetyModule.id)
            .where(
                SafetyProgress.user_id == user_id,
                SafetyProgress.completed.is_(True),
                SafetyModule.required.is_(True),
            )
        )
        or 0
    )
    return required_count > 0 and completed_count >= required_count


def _duplicate_receipt_exists(
    db: Session, application: Application, receipt_hash: str | None
) -> bool:
    if not receipt_hash:
        return False
    return (
        db.scalar(
            select(func.count(Application.id))
            .join(Subscription, Application.subscription_id == Subscription.id)
            .where(
                Application.id != application.id,
                Application.status.in_(ACTIVE_CLAIM_STATUSES),
                Subscription.receipt_hash == receipt_hash,
            )
        )
        or 0
    ) > 0


def _monthly_claim_exists(
    db: Session, application: Application, purchase_date: date | None
) -> bool:
    if purchase_date is None:
        return False
    month_start = purchase_date.replace(day=1)
    month_end = purchase_date.replace(day=monthrange(purchase_date.year, purchase_date.month)[1])
    return (
        db.scalar(
            select(func.count(Application.id))
            .join(Subscription, Application.subscription_id == Subscription.id)
            .where(
                and_(
                    Application.id != application.id,
                    Application.user_id == application.user_id,
                    Application.status.in_(MONTHLY_ALLOWANCE_STATUSES),
                    Subscription.purchase_date >= month_start,
                    Subscription.purchase_date <= month_end,
                )
            )
        )
        or 0
    ) > 0


def _receipt_evidence(
    subscription: Subscription | None,
) -> tuple[str | None, str | None, date | None, Decimal | None, float | None, list[str]]:
    """Return server-extracted eligibility values and any claimed/evidence conflicts.

    Before a receipt exists, the citizen's selected product remains useful workflow
    state. Once a receipt fingerprint exists, only the extraction payload is
    authoritative for eligibility. Denormalized subscription columns are still
    displayed, but a conflict can never be silently auto-approved.
    """

    if subscription is None:
        return None, None, None, None, None, []
    if not subscription.receipt_hash:
        return (
            subscription.provider,
            subscription.product,
            subscription.purchase_date,
            subscription.amount_twd,
            subscription.extraction_confidence,
            [],
        )
    if not subscription.extraction_json:
        return (
            None,
            None,
            None,
            None,
            None,
            ["Receipt fingerprint exists without authoritative extraction evidence."],
        )
    try:
        extracted = ReceiptExtraction.model_validate(subscription.extraction_json)
    except ValidationError:
        return (
            None,
            None,
            None,
            None,
            None,
            ["Authoritative receipt extraction evidence is invalid."],
        )

    amount_twd: Decimal | None = None
    if extracted.amount is not None and extracted.currency:
        try:
            amount_twd = convert_to_twd(extracted.amount, extracted.currency)
        except ValueError:
            amount_twd = None

    mismatches: list[str] = []
    comparisons = (
        ("provider", subscription.provider, extracted.provider, _normalize),
        ("product", subscription.product, extracted.product, _normalize),
        (
            "purchase date",
            subscription.purchase_date,
            extracted.purchase_date,
            lambda value: str(value),
        ),
        (
            "receipt amount",
            subscription.amount_twd,
            amount_twd,
            lambda value: str(Decimal(value).quantize(Decimal("0.01"))),
        ),
    )
    for label, claimed, evidence, normalize in comparisons:
        if (
            claimed is not None
            and evidence is not None
            and normalize(claimed) != normalize(evidence)
        ):
            mismatches.append(f"Claimed {label} conflicts with extracted receipt evidence")
    return (
        extracted.provider,
        extracted.product,
        extracted.purchase_date,
        amount_twd,
        extracted.confidence,
        mismatches,
    )


def evaluate_application(
    db: Session,
    application: Application,
    *,
    persist: bool = True,
    reserve_claim: bool = False,
) -> EligibilityEvaluation:
    subscription = application.subscription
    (
        evidence_provider,
        evidence_product,
        evidence_purchase_date,
        evidence_amount_twd,
        evidence_confidence,
        evidence_conflicts,
    ) = _receipt_evidence(subscription)
    policy_results = []
    if persist:
        policy_query = (
            f"Is {evidence_product} eligible and what application rules apply?"
            if evidence_product
            else "What evidence and eligibility rules apply to a subsidy application?"
        )
        policy_results = search_policy(db, policy_query, top_k=4)
        application.policy_citations_json = [
            result.citation.model_dump(mode="json") for result in policy_results
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
                    for result in policy_results
                ],
                "outcome": "retrieved" if policy_results else "not_established",
            },
        )
    data = EligibilityInput(
        age=application.user.age,
        identity_verified=application.user.identity_verified,
        provider=evidence_provider,
        product=evidence_product,
        purchase_date=evidence_purchase_date,
        receipt_hash=subscription.receipt_hash if subscription else None,
        user_id=application.user_id,
        amount_twd=evidence_amount_twd,
        safety_complete=safety_training_complete(db, application.user_id),
        duplicate_receipt=_duplicate_receipt_exists(
            db, application, subscription.receipt_hash if subscription else None
        ),
        monthly_claim_exists=_monthly_claim_exists(db, application, evidence_purchase_date),
        extraction_confidence=evidence_confidence,
        extraction_method=(
            subscription.extraction_json.get("extraction_method")
            if subscription and subscription.extraction_json
            else None
        ),
        inconsistent_fields=(
            evidence_conflicts
            + [
                warning
                for warning in subscription.extraction_warnings_json
                if "inconsisten" in warning.casefold() or "conflict" in warning.casefold()
            ]
            if subscription
            else evidence_conflicts
        ),
        suspicious_receipt=subscription.suspicious_content if subscription else False,
        policy_established=bool(policy_results) if persist else True,
    )
    if reserve_claim:
        preliminary = evaluate_eligibility(data)
        if preliminary.eligible:
            conflicts = reserve_claim_keys(db, application)
            if conflicts:
                data = data.model_copy(update={"claim_reservation_conflicts": conflicts})
    result = evaluate_eligibility(data)
    if persist:
        application.eligibility_result = result.outcome
        application.eligibility_reasons_json = [
            check.model_dump(mode="json") for check in result.checks
        ]
        application.risk_level = result.risk_level
        application.risk_reasons_json = result.risk_reasons
        application.requested_amount_twd = result.estimated_amount_twd
        application.approved_amount_twd = result.approved_amount_twd if result.eligible else None
        record_audit(
            db,
            "ELIGIBILITY_EVALUATED",
            ActorType.RULE_ENGINE,
            "deterministic-eligibility-v1",
            application=application,
            details={
                "outcome": result.outcome,
                "risk_level": result.risk_level,
                "checks": [check.model_dump(mode="json") for check in result.checks],
            },
        )
    return result
