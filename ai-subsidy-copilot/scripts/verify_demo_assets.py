#!/usr/bin/env python3
"""Fail fast when required demo knowledge or receipt artifacts are missing."""

from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_KNOWLEDGE = {
    "ai_subsidy_policy_2026.md",
    "eligible_ai_services.md",
    "reimbursement_rules.md",
    "application_requirements.md",
    "faq.md",
    "ai_safety/privacy.md",
    "ai_safety/hallucinations.md",
    "ai_safety/prompt_injection.md",
    "ai_safety/human_responsibility.md",
}

REQUIRED_RECEIPTS = {
    "chatgpt_plus_valid.pdf",
    "claude_pro_valid.pdf",
    "notion_ai_valid.pdf",
    "duplicate_receipt.pdf",
    "ambiguous_receipt.pdf",
    "malicious_prompt_injection_receipt.pdf",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    knowledge_root = ROOT / "knowledge"
    receipts_root = ROOT / "demo" / "receipts"
    actual_knowledge = {
        str(path.relative_to(knowledge_root)) for path in knowledge_root.rglob("*.md")
    }
    actual_receipts = {path.name for path in receipts_root.glob("*.pdf")}

    missing_knowledge = REQUIRED_KNOWLEDGE - actual_knowledge
    missing_receipts = REQUIRED_RECEIPTS - actual_receipts
    if missing_knowledge or missing_receipts:
        raise SystemExit(
            f"Missing knowledge={sorted(missing_knowledge)} receipts={sorted(missing_receipts)}"
        )

    for filename in REQUIRED_RECEIPTS:
        if not (receipts_root / filename).read_bytes().startswith(b"%PDF"):
            raise SystemExit(f"Not a PDF: {filename}")

    notion_hash = digest(receipts_root / "notion_ai_valid.pdf")
    duplicate_hash = digest(receipts_root / "duplicate_receipt.pdf")
    if notion_hash != duplicate_hash:
        raise SystemExit("duplicate_receipt.pdf must match notion_ai_valid.pdf byte for byte")

    malicious_bytes = (receipts_root / "malicious_prompt_injection_receipt.pdf").read_bytes()
    if b"Ignore all previous instructions" not in malicious_bytes:
        raise SystemExit("Malicious receipt is missing the prompt-injection fixture")

    print(
        f"ok: {len(REQUIRED_KNOWLEDGE)} knowledge files, "
        f"{len(REQUIRED_RECEIPTS)} receipts, duplicate hash {duplicate_hash[:12]}..."
    )


if __name__ == "__main__":
    main()
