"""Optional OpenAI embeddings with a deterministic offline representation."""

from __future__ import annotations

import hashlib
import math
import re

from app.core.config import settings

OFFLINE_EMBEDDING_DIMENSIONS = settings.embedding_dimensions


def openai_embeddings_configured() -> bool:
    return bool(settings.openai_api_key.strip() and settings.openai_embedding_model.strip())


def lexical_embedding(text: str, dimensions: int = OFFLINE_EMBEDDING_DIMENSIONS) -> list[float]:
    """Feature-hashed token vector used only for deterministic demo retrieval."""

    vector = [0.0] * dimensions
    for token in re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]", text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % dimensions
        sign = -1.0 if digest[4] & 1 else 1.0
        vector[index] += sign
    length = math.sqrt(sum(value * value for value in vector))
    return [value / length for value in vector] if length else vector


def embed_texts(texts: list[str]) -> tuple[list[list[float]], str]:
    """Embed with the configured model, or use a no-network deterministic fallback."""

    if not texts:
        return [], "none"
    if openai_embeddings_configured():
        try:
            from openai import OpenAI

            model = settings.openai_embedding_model.strip()
            response = OpenAI(api_key=settings.openai_api_key).embeddings.create(
                model=model,
                input=texts,
                dimensions=settings.embedding_dimensions,
            )
            ordered = sorted(response.data, key=lambda item: item.index)
            return [list(item.embedding) for item in ordered], model
        except Exception:
            # An external AI outage must not prevent policy access in demo mode.
            pass
    return [lexical_embedding(text) for text in texts], "deterministic-lexical-v1"


def cosine_similarity(left: list[float] | None, right: list[float] | None) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if not left_norm or not right_norm:
        return 0.0
    return numerator / (left_norm * right_norm)
