"""Mandatory AI-safety lesson progress and quiz evaluation."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import ActorType
from app.core.errors import ResourceNotFound
from app.models import SafetyModule, SafetyProgress, User, utcnow
from app.schemas.api import (
    SafetyModuleRead,
    SafetyProgressItem,
    SafetyProgressResponse,
)
from app.schemas.domain import SafetyAnswerResult
from app.services.audit import record_audit


def list_modules(db: Session) -> list[SafetyModuleRead]:
    modules = db.scalars(select(SafetyModule).order_by(SafetyModule.order_index)).all()
    return [
        SafetyModuleRead(
            id=module.id,
            slug=module.slug,
            title=module.title,
            content=module.content,
            required=module.required,
            order_index=module.order_index,
            question=module.question,
            choices=module.choices_json,
        )
        for module in modules
    ]


def get_safety_progress(db: Session, user_id: uuid.UUID) -> SafetyProgressResponse:
    if db.get(User, user_id) is None:
        raise ResourceNotFound("USER_NOT_FOUND", "Demo user was not found.")
    modules = db.scalars(select(SafetyModule).order_by(SafetyModule.order_index)).all()
    progress_by_module = {
        progress.module_id: progress
        for progress in db.scalars(
            select(SafetyProgress).where(SafetyProgress.user_id == user_id)
        ).all()
    }
    items: list[SafetyProgressItem] = []
    for module in modules:
        progress = progress_by_module.get(module.id)
        items.append(
            SafetyProgressItem(
                module_id=module.id,
                slug=module.slug,
                title=module.title,
                required=module.required,
                completed=bool(progress and progress.completed),
                score=progress.score if progress else 0,
                attempts=progress.attempts if progress else 0,
                completed_at=progress.completed_at if progress else None,
            )
        )
    required = [item for item in items if item.required]
    completed = sum(item.completed for item in required)
    return SafetyProgressResponse(
        user_id=user_id,
        completed_required=completed,
        total_required=len(required),
        all_required_complete=bool(required) and completed == len(required),
        modules=items,
    )


def answer_module(
    db: Session,
    *,
    user_id: uuid.UUID,
    module_id: uuid.UUID,
    answer: str,
) -> SafetyAnswerResult:
    if db.get(User, user_id) is None:
        raise ResourceNotFound("USER_NOT_FOUND", "Demo user was not found.")
    module = db.get(SafetyModule, module_id)
    if module is None:
        raise ResourceNotFound("SAFETY_MODULE_NOT_FOUND", "Safety module was not found.")
    progress = db.scalar(
        select(SafetyProgress).where(
            SafetyProgress.user_id == user_id,
            SafetyProgress.module_id == module_id,
        )
    )
    if progress is None:
        progress = SafetyProgress(
            user_id=user_id,
            module_id=module_id,
            completed=False,
            score=0,
            attempts=0,
        )
        db.add(progress)
    progress.attempts += 1
    correct = answer.strip().upper() == module.correct_answer.strip().upper()
    if correct:
        was_complete = progress.completed
        progress.completed = True
        progress.score = 100
        progress.completed_at = progress.completed_at or utcnow()
        if not was_complete:
            record_audit(
                db,
                action="SAFETY_MODULE_COMPLETED",
                actor_type=ActorType.CITIZEN,
                actor_identifier=str(user_id),
                user_id=user_id,
                details={"module_id": str(module.id), "slug": module.slug, "score": 100},
            )
    elif not progress.completed:
        progress.score = 0
    db.commit()
    db.refresh(progress)
    return SafetyAnswerResult(
        correct=correct,
        completed=progress.completed,
        score=progress.score,
        attempts=progress.attempts,
        explanation=(
            module.explanation
            if correct
            else "That answer is not correct yet. Review the lesson and try again."
        ),
    )
