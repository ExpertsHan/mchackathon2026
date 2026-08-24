from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from pypdf import PdfWriter
from sqlalchemy.orm import Session

from app.core.enums import ApplicationStatus
from app.schemas import EligibilityInput
from app.schemas.receipt import ReceiptExtraction
from app.services.applications import create_application
from app.services.demo import DEMO_USER_IDS
from app.services.eligibility import evaluate_eligibility
from app.services.evidence import attach_receipt, receipt_duplicate_exists
from app.services.receipts import ReceiptError, sha256_bytes, store_and_extract

RECEIPTS = Path(__file__).resolve().parents[2] / "demo" / "receipts"


def test_valid_pdf_receipt_extracts_required_fields(tmp_path: Path) -> None:
    path = RECEIPTS / "chatgpt_plus_valid.pdf"
    result = store_and_extract(
        filename=path.name,
        content_type="application/pdf",
        data=path.read_bytes(),
        storage_directory=tmp_path,
    )
    assert result.extraction.provider == "OpenAI"
    assert result.extraction.product == "ChatGPT Plus"
    assert str(result.extraction.amount) == "20.00"
    assert result.extraction.currency == "USD"
    assert result.extraction.purchase_date.isoformat() == "2026-08-18"
    assert (tmp_path / result.storage_filename).exists()


def test_invalid_file_type_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ReceiptError) as caught:
        store_and_extract(
            filename="receipt.txt",
            content_type="text/plain",
            data=b"Provider: OpenAI",
            storage_directory=tmp_path,
        )
    assert caught.value.code == "UNSUPPORTED_RECEIPT_FORMAT"


def test_malformed_pdf_is_not_persisted(tmp_path: Path) -> None:
    with pytest.raises(ReceiptError):
        store_and_extract(
            filename="broken.pdf",
            content_type="application/pdf",
            data=b"%PDF-this-is-not-parseable",
            storage_directory=tmp_path,
        )
    assert list(tmp_path.iterdir()) == []


def test_pdf_page_limit_is_enforced_before_storage(tmp_path: Path) -> None:
    writer = PdfWriter()
    for _ in range(11):
        writer.add_blank_page(width=100, height=100)
    from io import BytesIO

    buffer = BytesIO()
    writer.write(buffer)
    with pytest.raises(ReceiptError) as caught:
        store_and_extract(
            filename="too-many-pages.pdf",
            content_type="application/pdf",
            data=buffer.getvalue(),
            storage_directory=tmp_path,
        )
    assert caught.value.code == "RECEIPT_TOO_COMPLEX"
    assert list(tmp_path.iterdir()) == []


def test_seeded_duplicate_sha_is_detected(db: Session) -> None:
    path = RECEIPTS / "duplicate_receipt.pdf"
    assert receipt_duplicate_exists(db, sha256_bytes(path.read_bytes())) is True


def test_malicious_receipt_is_data_and_never_changes_state(db: Session, tmp_path: Path) -> None:
    draft = create_application(db, DEMO_USER_IDS["alex"])
    db.commit()
    path = RECEIPTS / "malicious_prompt_injection_receipt.pdf"
    subscription, stored, _ = attach_receipt(
        db,
        draft,
        filename=path.name,
        content_type="application/pdf",
        data=path.read_bytes(),
        actor_identifier="test-citizen",
        storage_directory=tmp_path,
    )
    assert stored.extraction.provider == "OpenAI"
    assert stored.extraction.product == "ChatGPT Plus"
    assert stored.extraction.amount == 20
    assert subscription.suspicious_content is True
    assert any("ignored" in warning for warning in stored.extraction.warnings)
    assert draft.status is ApplicationStatus.DRAFT
    assert draft.approved_amount_twd is None
    assert draft.payment is None


def test_high_confidence_vision_only_fields_still_require_review(
    monkeypatch,
    tmp_path: Path,
) -> None:
    adversarial = ReceiptExtraction(
        provider="OpenAI",
        product="ChatGPT Plus",
        amount=Decimal("20"),
        currency="USD",
        purchase_date=date(2026, 8, 18),
        receipt_reference="VISION-SAYS-APPROVE",
        confidence=1.0,
        extraction_method="openai-vision",
    )
    monkeypatch.setattr("app.services.receipts._vision_extract", lambda *_: adversarial)
    stored = store_and_extract(
        filename="adversarial.png",
        content_type="image/png",
        data=b"\x89PNG\r\n\x1a\nnot-a-real-image-but-valid-demo-header",
        storage_directory=tmp_path,
    )
    result = evaluate_eligibility(
        EligibilityInput(
            age=21,
            identity_verified=True,
            provider=stored.extraction.provider,
            product=stored.extraction.product,
            purchase_date=stored.extraction.purchase_date,
            receipt_hash=stored.sha256,
            amount_twd=Decimal("600"),
            safety_complete=True,
            extraction_confidence=stored.extraction.confidence,
            extraction_method=stored.extraction.extraction_method,
        )
    )
    assert stored.extraction.confidence == 1
    assert result.eligible is False
    assert result.requires_manual_review is True
    assert result.risk_level.value == "MEDIUM"
    assert any("Vision-only" in reason for reason in result.risk_reasons)
