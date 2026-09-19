"""Upload validation shared by every applicant document (private, size-bounded)."""

from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path

from pypdf import PdfReader

from app.core.config import settings

SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
SUPPORTED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}
MAX_RECEIPT_BYTES = settings.max_receipt_bytes


class ReceiptError(ValueError):
    """A safe, client-displayable receipt validation error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def sanitize_filename(filename: str) -> str:
    """Return a display-only basename without path or control characters."""

    basename = Path(filename.replace("\\", "/")).name
    cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", basename).strip(" .")
    return (cleaned or "receipt")[:180]


def validate_upload(filename: str, content_type: str | None, data: bytes) -> tuple[str, str]:
    display_name = sanitize_filename(filename)
    suffix = Path(display_name).suffix.lower()
    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    if suffix not in SUPPORTED_EXTENSIONS or normalized_type not in SUPPORTED_CONTENT_TYPES:
        raise ReceiptError(
            "UNSUPPORTED_RECEIPT_FORMAT",
            "請上傳 PDF、PNG、JPG 或 WEBP 檔案。",
        )
    if not data:
        raise ReceiptError("INVALID_RECEIPT", "The uploaded receipt is empty.")
    if len(data) > MAX_RECEIPT_BYTES:
        raise ReceiptError(
            "RECEIPT_TOO_LARGE",
            f"Receipt exceeds the {MAX_RECEIPT_BYTES // (1024 * 1024)} MB upload limit.",
        )
    if suffix == ".pdf" and not data.startswith(b"%PDF"):
        raise ReceiptError("INVALID_RECEIPT", "The uploaded file is not a valid PDF.")
    if suffix == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ReceiptError("INVALID_RECEIPT", "The uploaded file is not a valid PNG image.")
    if suffix in {".jpg", ".jpeg"} and not data.startswith(b"\xff\xd8\xff"):
        raise ReceiptError("INVALID_RECEIPT", "The uploaded file is not a valid JPEG image.")
    if suffix == ".webp" and not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        raise ReceiptError("INVALID_RECEIPT", "The uploaded file is not a valid WEBP image.")
    return display_name, normalized_type


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        if len(reader.pages) > settings.max_pdf_pages:
            raise ReceiptError(
                "RECEIPT_TOO_COMPLEX",
                f"Receipt PDF may contain at most {settings.max_pdf_pages} pages.",
            )
        remaining = settings.max_extracted_chars
        parts: list[str] = []
        for page in reader.pages:
            if remaining <= 0:
                break
            page_text = page.extract_text() or ""
            parts.append(page_text[:remaining])
            remaining -= len(parts[-1])
        return "\n".join(parts)
    except ReceiptError:
        raise
    except Exception as exc:  # malformed PDFs have many library-specific exceptions
        raise ReceiptError("INVALID_RECEIPT", "The PDF could not be read.") from exc
