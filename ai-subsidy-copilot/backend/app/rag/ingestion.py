"""Load and chunk the fictional government knowledge corpus."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import PolicyDocument
from app.rag.embeddings import embed_texts


@dataclass(frozen=True)
class DocumentChunk:
    document_name: str
    section: str
    article: str | None
    content: str
    topic: str
    version: str = "2026.1"
    effective_from: date = date(2026, 1, 1)
    effective_to: date = date(2026, 12, 31)


def _display_name(path: Path, markdown: str) -> str:
    match = re.search(r"(?m)^#\s+(.+?)\s*$", markdown)
    if match:
        return match.group(1).strip()
    return path.stem.replace("_", " ").title()


def _topic(path: Path, heading: str) -> str:
    joined = f"{path.stem} {heading}".lower()
    topics = (
        "privacy",
        "hallucinations",
        "prompt_injection",
        "human_responsibility",
        "eligibility",
        "reimbursement",
        "application",
        "faq",
    )
    for topic in topics:
        if topic.replace("_", " ") in joined or topic in joined:
            return topic
    return "program_policy"


def chunk_markdown(path: Path) -> list[DocumentChunk]:
    markdown = path.read_text(encoding="utf-8")
    document_name = _display_name(path, markdown)
    heading_matches = list(re.finditer(r"(?m)^(#{2,3})\s+(.+?)\s*$", markdown))
    if not heading_matches:
        content = markdown.strip()
        return (
            [
                DocumentChunk(
                    document_name=document_name,
                    section=document_name,
                    article=None,
                    content=content,
                    topic=_topic(path, document_name),
                )
            ]
            if content
            else []
        )

    chunks: list[DocumentChunk] = []
    for index, match in enumerate(heading_matches):
        end = (
            heading_matches[index + 1].start()
            if index + 1 < len(heading_matches)
            else len(markdown)
        )
        heading = match.group(2).strip()
        body = markdown[match.end() : end].strip()
        if not body:
            continue
        article_match = re.search(r"(?i)\bArticle\s+\d+\b", heading)
        article = article_match.group(0).title() if article_match else None
        content = f"{heading}\n\n{body}"
        chunks.append(
            DocumentChunk(
                document_name=document_name,
                section=heading,
                article=article,
                content=content,
                topic=_topic(path, heading),
            )
        )
    return chunks


def load_knowledge(knowledge_directory: str | Path) -> list[DocumentChunk]:
    root = Path(knowledge_directory)
    if not root.exists():
        raise FileNotFoundError(f"Knowledge directory does not exist: {root}")
    chunks: list[DocumentChunk] = []
    for path in sorted(root.rglob("*.md")):
        chunks.extend(chunk_markdown(path))
    return chunks


def ingest_knowledge(
    db: Session,
    knowledge_directory: str | Path,
    *,
    replace: bool = True,
) -> int:
    chunks = load_knowledge(knowledge_directory)
    vectors, embedding_model = embed_texts([chunk.content for chunk in chunks])
    if replace:
        db.execute(delete(PolicyDocument))
    for chunk, vector in zip(chunks, vectors, strict=True):
        values = {
            "document_name": chunk.document_name,
            "section": chunk.section,
            "content": chunk.content,
            "embedding": vector,
            "effective_from": chunk.effective_from,
            "effective_to": chunk.effective_to,
            "version": chunk.version,
            "metadata_json": {
                "article": chunk.article,
                "topic": chunk.topic,
                "embedding_model": embedding_model,
                "source_type": "fictional_demo_policy",
            },
            "content_hash": hashlib.sha256(
                f"{chunk.document_name}\n{chunk.section}\n{chunk.content}".encode()
            ).hexdigest(),
        }
        # Keep ingestion compatible with migrations that promote metadata columns.
        if hasattr(PolicyDocument, "article"):
            values["article"] = chunk.article
        db.add(PolicyDocument(**values))
    db.commit()
    return len(chunks)
