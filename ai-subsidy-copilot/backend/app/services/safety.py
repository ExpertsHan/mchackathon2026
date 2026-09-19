"""Optional AI-safety learning, quiz evaluation, and engagement tracking."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import ActorType
from app.core.errors import DomainError, ResourceNotFound
from app.models import Application, SafetyModule, SafetyProgress, User, utcnow
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
    completed_required = sum(item.completed for item in required)
    completed_count = sum(item.completed for item in items)
    return SafetyProgressResponse(
        user_id=user_id,
        completed_count=completed_count,
        total_count=len(items),
        all_complete=bool(items) and completed_count == len(items),
        participation_optional=True,
        completed_required=completed_required,
        total_required=len(required),
        all_required_complete=not required or completed_required == len(required),
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
    normalized_answer = answer.strip().upper()
    if normalized_answer not in {choice["id"].upper() for choice in module.choices_json}:
        raise DomainError("INVALID_SAFETY_ANSWER", "Choose one of the available answers.")
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
    correct = normalized_answer == module.correct_answer.strip().upper()
    was_complete = progress.completed
    progress.completed = True
    progress.score = 100 if correct else 0
    progress.completed_at = progress.completed_at or utcnow()
    if not was_complete:
        record_audit(
            db,
            action="SAFETY_MODULE_REVIEWED",
            actor_type=ActorType.CITIZEN,
            actor_identifier=str(user_id),
            user_id=user_id,
            details={
                "module_id": str(module.id),
                "slug": module.slug,
                "correct": correct,
                "score": progress.score,
            },
        )
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
            else f"The safer answer is explained here: {module.explanation}"
        ),
    )


def record_engagement(
    db: Session,
    *,
    user_id: uuid.UUID,
    application: Application | None,
    event: str,
    selected_option: str | None = None,
) -> None:
    """Store exposure, participation, and understanding as separate audit events."""

    if db.get(User, user_id) is None:
        raise ResourceNotFound("USER_NOT_FOUND", "Demo user was not found.")
    details: dict[str, str | bool] = {"participation_optional": True}
    if selected_option is not None:
        details["selected_option"] = selected_option
        details["correct"] = selected_option == "B"
        details["exercise_version"] = "subscription-total-v1"
    record_audit(
        db,
        action=f"SAFETY_{event}",
        actor_type=ActorType.CITIZEN,
        actor_identifier=str(user_id),
        user_id=user_id,
        application=application,
        details=details,
    )
    db.commit()
