"""Reuse the OCR JavaScript modules through a bounded private process."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from app.core.config import settings
from app.core.identity import hash_government_id, mask_government_id

TEXT_FIELDS = {
    "document_type",
    "buyer_name",
    "buyer_email",
    "product_name",
    "company_name",
    "purchase_date",
    "subscription_period",
    "renewal_date",
    "currency",
    "payment_method",
    "purchase_source",
    "plan_type",
    "card_last4",
    "card_holder_name",
    "receipt_reference",
    "side",
    "name",
    "id_number",
    "birth_date",
    "address",
    "bank_name",
    "bank_code",
    "account_number",
    "account_holder_name",
}
NUMBER_FIELDS = {"original_amount", "converted_twd_amount"}
BOOLEAN_FIELDS = {"has_payment_proof", "is_hsinchu_city"}


class OcrUnavailable(ValueError):
    pass


def call_bridge(payload: dict) -> dict:
    environment = os.environ.copy()
    environment["GEMINI_API_KEY"] = settings.gemini_api_key
    environment["GEMINI_OCR_MODEL"] = settings.gemini_ocr_model
    environment["OPENAI_API_KEY"] = settings.openai_api_key
    environment["OPENAI_OCR_MODEL"] = settings.openai_model
    environment["AI_PROVIDER"] = settings.ai_provider
    try:
        process = subprocess.run(
            [settings.ocr_node_binary, str(settings.ocr_module_dir / "copilot-bridge.js")],
            input=json.dumps(payload, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=settings.ocr_timeout_seconds,
            env=environment,
            check=True,
        )
        result = json.loads(process.stdout)
        if not isinstance(result, dict):
            raise ValueError("Invalid OCR response")
        return result
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise OcrUnavailable("OCR 分析暫時無法使用，請重試或由承辦人確認。") from exc


def sanitize_ocr_data(data: object) -> dict:
    if not isinstance(data, dict):
        return {}
    clean: dict = {}
    for key, value in data.items():
        if key in TEXT_FIELDS and isinstance(value, str) and value.strip():
            clean[key] = value.strip()[:500]
        elif key in NUMBER_FIELDS and type(value) in (int, float) and 0 <= value <= 1_000_000:
            clean[key] = value
        elif key in BOOLEAN_FIELDS and type(value) is bool:
            clean[key] = value
    confidence = data.get("_confidence", {})
    clean["_confidence"] = (
        {
            key: score
            for key, score in confidence.items()
            if key in clean and type(score) in (int, float) and 0 <= score <= 1
        }
        if isinstance(confidence, dict)
        else {}
    )
    return clean


def protect_identifiers(data: dict) -> dict:
    """Replace a read national ID by its mask plus a keyed hash before anything is stored."""

    number = data.get("id_number")
    if isinstance(number, str) and number.strip():
        data["id_number_hash"] = hash_government_id(number)
        data["id_number"] = mask_government_id(number)
    return data


def extract_document(data: bytes, suffix: str, document_type: str) -> dict:
    if document_type not in {"receipt", "id_card", "passbook"}:
        return {"status": "uploaded", "data": {}}
    if not (settings.gemini_api_key.strip() or settings.openai_api_key.strip()):
        return {
            "status": "skipped",
            "data": {"_error": "未設定 OCR 金鑰（Gemini 或 OpenAI），請由承辦人檢視原始文件。"},
        }
    # Windows cannot reopen a NamedTemporaryFile while it is still open.
    with tempfile.TemporaryDirectory(prefix="copilot-ocr-") as directory:
        file_path = Path(directory) / f"document{suffix}"
        file_path.write_bytes(data)
        try:
            result = call_bridge(
                {
                    "operation": "extract",
                    "document_type": document_type,
                    "file_path": str(file_path),
                }
            )
        except OcrUnavailable as exc:
            return {"status": "failed", "data": {"_error": str(exc)}}
    if result.get("status") != "done":
        return {"status": "failed", "data": {"_error": "文件辨識失敗，請重試或由承辦人檢視。"}}
    clean = sanitize_ocr_data(result.get("data"))
    if not any(key != "_confidence" for key in clean):
        return {"status": "failed", "data": {"_error": "無法讀取文件欄位，請提供清晰文件。"}}
    return {"status": "done", "data": protect_identifiers(clean)}
