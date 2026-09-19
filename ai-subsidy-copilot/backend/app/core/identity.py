"""National ID handling: normalize, mask for display, and keyed-hash for duplicate lookup.

The plaintext ID only passes through request handling. It is never stored; a keyed
hash (HMAC, so the small ID space cannot be brute-forced without the server secret)
identifies "the same person" across applications.
"""

from __future__ import annotations

import hashlib
import hmac
import re

from app.core.config import settings

ID_PATTERN = re.compile(r"^[A-Z][0-9A-D][0-9]{8}$")


def normalize_government_id(value: str | None) -> str:
    return re.sub(r"\s+", "", (value or "")).upper()


def is_valid_government_id(value: str | None) -> bool:
    return bool(ID_PATTERN.fullmatch(normalize_government_id(value)))


def hash_government_id(value: str) -> str:
    key = hashlib.sha256(f"government-id:{settings.demo_auth_secret}".encode()).digest()
    return hmac.new(key, normalize_government_id(value).encode(), hashlib.sha256).hexdigest()


def mask_government_id(value: str) -> str:
    normalized = normalize_government_id(value)
    if len(normalized) < 7:
        return "*" * len(normalized)
    return f"{normalized[:3]}****{normalized[-3:]}"
