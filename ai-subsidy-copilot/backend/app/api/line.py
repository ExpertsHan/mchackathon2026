"""LINE account linking and the internal API used by the Node LINE bot.

The bot never touches the database: it asks this API. Internal endpoints require the
shared ``LINE_INTEGRATION_SECRET`` and are disabled while it is unset.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, timedelta

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_demo_user, issue_demo_token
from app.core.config import settings
from app.core.database import get_db
from app.core.enums import ActorType, ApplicationStatus
from app.core.errors import DomainError
from app.models import Application, LineBinding, LineLinkCode, User, utcnow
from app.schemas.api import DemoLoginResponse, LineLinkRequest, MessageResponse
from app.schemas.domain import UserRead
from app.services.applications import cancel_application
from app.services.audit import record_audit

router = APIRouter(tags=["line"])

STATUS_LABEL = {
    ApplicationStatus.DRAFT: "尚未送出（草稿）",
    ApplicationStatus.SUBMITTED: "已受理，等待審核",
    ApplicationStatus.VERIFYING: "審核中",
    ApplicationStatus.MANUAL_REVIEW: "審核中，承辦人員複核中",
    ApplicationStatus.REQUESTED_INFORMATION: "需要補件，請留意通知",
    ApplicationStatus.APPROVED: "已核准，準備撥款",
    ApplicationStatus.PAYMENT_SCHEDULED: "已核准，撥款排程中",
    ApplicationStatus.PAID: "補助款已撥款完成",
    ApplicationStatus.REJECTED: "不通過",
    ApplicationStatus.CANCELLED: "已取消",
}


def require_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    secret = settings.line_integration_secret
    if not secret or not x_internal_key or not hmac.compare_digest(x_internal_key, secret):
        raise DomainError("UNAUTHORIZED", "Invalid internal key.", status_code=401)


def _aware(moment):
    # SQLite hands back naive datetimes; treat them as UTC like the PostgreSQL path.
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


class LineUserRequest(BaseModel):
    line_user_id: str = Field(min_length=5, max_length=128)


@router.post("/api/internal/line/link-code", dependencies=[Depends(require_internal_key)])
def issue_link_code(payload: LineUserRequest, db: Session = Depends(get_db)) -> dict:
    code = secrets.token_urlsafe(9)
    db.add(
        LineLinkCode(
            line_user_id=payload.line_user_id,
            code_hash=_hash(code),
            expires_at=utcnow() + timedelta(minutes=settings.line_link_code_ttl_minutes),
        )
    )
    db.commit()
    origin = settings.frontend_origin.rstrip("/")
    return {"code": code, "url": f"{origin}/apply?line_code={code}"}


def _applications_for(db: Session, line_user_id: str) -> list[Application]:
    return list(
        db.scalars(
            select(Application)
            .join(LineBinding, LineBinding.user_id == Application.user_id)
            .where(LineBinding.line_user_id == line_user_id)
            .order_by(Application.created_at.desc())
        ).all()
    )


@router.get("/api/internal/line/applications", dependencies=[Depends(require_internal_key)])
def line_applications(line_user_id: str, db: Session = Depends(get_db)) -> dict:
    return {
        "applications": [
            {
                "public_id": application.public_id,
                "status": application.status.value,
                "status_label": STATUS_LABEL[application.status],
                "note": application.information_request,
            }
            for application in _applications_for(db, line_user_id)
            if application.status is not ApplicationStatus.DRAFT
        ]
    }


@router.post("/api/internal/line/cancel", dependencies=[Depends(require_internal_key)])
def line_cancel(payload: LineUserRequest, db: Session = Depends(get_db)) -> dict:
    cancellable = {
        ApplicationStatus.SUBMITTED,
        ApplicationStatus.VERIFYING,
        ApplicationStatus.MANUAL_REVIEW,
        ApplicationStatus.REQUESTED_INFORMATION,
    }
    target = next(
        (a for a in _applications_for(db, payload.line_user_id) if a.status in cancellable), None
    )
    if target is None:
        return {"cancelled": None}
    application = db.scalar(
        select(Application).where(Application.id == target.id).with_for_update()
    )
    cancel_application(db, application, actor_identifier=f"line:{payload.line_user_id[:8]}")
    db.commit()
    return {"cancelled": application.public_id}


@router.post("/api/line/bind", response_model=MessageResponse)
def bind_line(
    payload: LineLinkRequest,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> MessageResponse:
    link = db.scalar(select(LineLinkCode).where(LineLinkCode.code_hash == _hash(payload.code)))
    if link is None or link.used_at is not None or _aware(link.expires_at) < utcnow():
        raise DomainError(
            "LINK_CODE_INVALID",
            "此連結已失效，請回 LINE 重新輸入「申請」。",
            status_code=400,
        )
    existing = db.get(LineBinding, current_user.id)
    holder = db.scalar(select(LineBinding).where(LineBinding.line_user_id == link.line_user_id))
    if holder is not None and holder.user_id != current_user.id:
        db.delete(holder)
        db.flush()
    if existing is None:
        db.add(LineBinding(user_id=current_user.id, line_user_id=link.line_user_id))
    else:
        existing.line_user_id = link.line_user_id
    link.user_id = current_user.id
    link.used_at = utcnow()
    db.commit()
    return MessageResponse(message="LINE 帳號已綁定，後續進度會透過 LINE 通知。")


class ApplicantStartRequest(BaseModel):
    line_code: str | None = Field(default=None, max_length=64)


@router.post("/api/applicants/start", response_model=DemoLoginResponse, tags=["applicants"])
def start_applicant(
    payload: ApplicantStartRequest, db: Session = Depends(get_db)
) -> DemoLoginResponse:
    """Open a session for an applicant. There is no profile picker: a new record is created.

    With a valid one-time LINE code the session is tied to that LINE account: a returning
    LINE user gets their existing record back, otherwise a new one is created and bound.
    """

    link = None
    if payload.line_code:
        link = db.scalar(
            select(LineLinkCode).where(LineLinkCode.code_hash == _hash(payload.line_code))
        )
        if link is None or link.used_at is not None or _aware(link.expires_at) < utcnow():
            raise DomainError(
                "LINK_CODE_INVALID",
                "此連結已失效，請回 LINE 重新輸入「申請」。",
                status_code=400,
            )
    user = None
    if link is not None:
        binding = db.scalar(
            select(LineBinding).where(LineBinding.line_user_id == link.line_user_id)
        )
        user = db.get(User, binding.user_id) if binding is not None else None
    if user is None:
        user = User(
            name="申請人",
            government_id_masked="尚未填寫",
            age=0,
            email=f"applicant-{secrets.token_hex(6)}@applicants.local",
            identity_verified=False,
        )
        db.add(user)
        db.flush()
        if link is not None:
            db.add(LineBinding(user_id=user.id, line_user_id=link.line_user_id))
    if link is not None:
        link.user_id = user.id
        link.used_at = utcnow()
    record_audit(
        db,
        action="USER_LOGGED_IN",
        actor_type=ActorType.CITIZEN,
        actor_identifier=str(user.id),
        user_id=user.id,
        details={"authentication": "line_link" if link is not None else "guest"},
    )
    db.commit()
    return DemoLoginResponse(
        user=UserRead.model_validate(user), demo_token=issue_demo_token(user.id)
    )
