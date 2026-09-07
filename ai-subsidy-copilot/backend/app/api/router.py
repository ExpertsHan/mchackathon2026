"""Complete REST surface for citizen, agent, safety, and reviewer demos."""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.runtime import chat, history, stream_chat_events
from app.core.auth import (
    get_current_demo_user,
    issue_demo_token,
    require_application_owner,
    require_user,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.enums import ActorType, ApplicationStatus, RiskLevel
from app.core.errors import DomainError, ResourceNotFound
from app.models import Application, User
from app.rag.retrieval import answer_policy_question
from app.schemas import (
    ApplicationCreate,
    ApplicationRead,
    DemoLoginRequest,
    PaymentRead,
    ReviewerActionRequest,
    SafetyAnswerRequest,
    SafetyAnswerResult,
    SubscriptionInput,
    UserRead,
)
from app.schemas.api import (
    AdminApplicationsResponse,
    AdminStats,
    AgentChatRequest,
    AgentChatResponse,
    AgentHistoryResponse,
    ApplicationDetail,
    CitizenApplicationDetail,
    CitizenSubscriptionRead,
    DemoLoginResponse,
    MessageResponse,
    ReceiptUploadResponse,
    SafetyModuleRead,
    SafetyProgressResponse,
    TimelineResponse,
)
from app.schemas.domain import EligibilityEvaluation
from app.schemas.policy import PolicyAnswer, PolicyQuery
from app.services.applications import (
    approve_application,
    create_application,
    get_application_by_public_id,
    reject_application,
    request_more_information,
    set_subscription,
    submit_application,
)
from app.services.audit import record_audit
from app.services.demo import reset_demo_data
from app.services.eligibility import evaluate_application
from app.services.evidence import attach_receipt
from app.services.payments import process_payment
from app.services.queries import (
    admin_applications,
    admin_stats,
    application_detail,
    citizen_application_detail,
    citizen_subscription,
    timeline,
)
from app.services.safety import answer_module, get_safety_progress, list_modules
from app.services.verification import run_verification

router = APIRouter()


@router.get("/api/demo/users", response_model=list[UserRead], tags=["demo"])
def demo_users(db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.name)).all())


@router.post("/api/demo/login", response_model=DemoLoginResponse, tags=["demo"])
def demo_login(payload: DemoLoginRequest, db: Session = Depends(get_db)) -> DemoLoginResponse:
    user = db.get(User, payload.user_id)
    if user is None:
        raise ResourceNotFound("USER_NOT_FOUND", "The selected demo applicant was not found.")
    record_audit(
        db,
        action="USER_LOGGED_IN",
        actor_type=ActorType.CITIZEN,
        actor_identifier=str(user.id),
        user_id=user.id,
        details={"authentication": "fictional_demo_selector"},
    )
    db.commit()
    return DemoLoginResponse(
        user=UserRead.model_validate(user), demo_token=issue_demo_token(user.id)
    )


@router.post("/api/demo/reset", response_model=MessageResponse, tags=["demo"])
def demo_reset(db: Session = Depends(get_db)) -> MessageResponse:
    if not settings.demo_mode:
        raise DomainError(
            "DEMO_MODE_REQUIRED",
            "Demo reset is disabled outside DEMO_MODE.",
            status_code=403,
        )
    reset_demo_data(db)
    return MessageResponse(message="Demo data was reset and reseeded.")


@router.post("/api/applications", response_model=ApplicationRead, tags=["applications"])
def create_application_endpoint(
    payload: ApplicationCreate,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> Application:
    require_user(current_user, payload.user_id)
    application = create_application(db, payload.user_id)
    db.commit()
    db.refresh(application)
    return application


@router.get(
    "/api/applications/{public_id}",
    response_model=CitizenApplicationDetail,
    tags=["applications"],
)
def get_application_endpoint(
    public_id: str,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> CitizenApplicationDetail:
    application = get_application_by_public_id(db, public_id)
    require_application_owner(current_user, application)
    return citizen_application_detail(db, public_id)


@router.get(
    "/api/users/{user_id}/applications",
    response_model=list[ApplicationRead],
    tags=["applications"],
)
def user_applications(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> list[Application]:
    require_user(current_user, user_id)
    if db.get(User, user_id) is None:
        raise ResourceNotFound("USER_NOT_FOUND", "Demo user was not found.")
    return list(
        db.scalars(
            select(Application)
            .where(Application.user_id == user_id)
            .order_by(Application.created_at.desc())
        ).all()
    )


@router.post(
    "/api/applications/{public_id}/subscription",
    response_model=CitizenSubscriptionRead,
    tags=["applications"],
)
def select_subscription(
    public_id: str,
    payload: SubscriptionInput,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
):
    application = get_application_by_public_id(db, public_id)
    require_application_owner(current_user, application)
    subscription = set_subscription(
        db,
        application,
        payload,
        actor_identifier=str(application.user_id),
    )
    db.commit()
    db.refresh(subscription)
    return citizen_subscription(subscription)


@router.post(
    "/api/applications/{public_id}/receipt",
    response_model=ReceiptUploadResponse,
    tags=["receipts"],
)
def upload_receipt(
    public_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> ReceiptUploadResponse:
    application = get_application_by_public_id(db, public_id)
    require_application_owner(current_user, application)
    data = file.file.read(settings.max_receipt_bytes + 1)
    subscription, _, duplicate = attach_receipt(
        db,
        application,
        filename=file.filename or "receipt",
        content_type=file.content_type,
        data=data,
        actor_identifier=str(application.user_id),
    )
    rate_notice = None
    if subscription.currency in settings.mock_exchange_rates:
        rate = settings.mock_exchange_rates[subscription.currency]
        rate_notice = f"1 {subscription.currency} = NT${rate} (mock demo rate)"
    return ReceiptUploadResponse(
        subscription=citizen_subscription(subscription),
        duplicate_receipt=duplicate,
        mock_exchange_rate=rate_notice,
        requires_manual_review=(
            duplicate
            or bool(subscription.extraction_confidence is None)
            or subscription.extraction_confidence < settings.minimum_extraction_confidence
            or subscription.suspicious_content
        ),
    )


@router.get(
    "/api/applications/{public_id}/receipt",
    response_model=CitizenSubscriptionRead,
    tags=["receipts"],
)
def get_receipt(
    public_id: str,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
):
    application = get_application_by_public_id(db, public_id)
    require_application_owner(current_user, application)
    if application.subscription is None or not application.subscription.receipt_hash:
        raise ResourceNotFound("RECEIPT_NOT_FOUND", "No receipt has been uploaded.")
    return citizen_subscription(application.subscription)


@router.post(
    "/api/applications/{public_id}/eligibility/check",
    response_model=EligibilityEvaluation,
    tags=["eligibility"],
)
def check_eligibility(
    public_id: str,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> EligibilityEvaluation:
    application = get_application_by_public_id(db, public_id)
    require_application_owner(current_user, application)
    if application.status not in {
        ApplicationStatus.DRAFT,
        ApplicationStatus.REQUESTED_INFORMATION,
    }:
        raise DomainError(
            "ELIGIBILITY_CHECK_NOT_ALLOWED",
            "A finalized application uses its recorded eligibility decision.",
            status_code=409,
        )
    evaluation = evaluate_application(db, application, persist=True)
    db.commit()
    return evaluation


@router.post(
    "/api/applications/{public_id}/submit",
    response_model=CitizenApplicationDetail,
    tags=["applications"],
)
def submit(
    public_id: str,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> CitizenApplicationDetail:
    application = get_application_by_public_id(db, public_id, for_update=True)
    require_application_owner(current_user, application)
    submit_application(db, application, actor_identifier=str(application.user_id))
    db.commit()
    return citizen_application_detail(db, public_id)


@router.get(
    "/api/applications/{public_id}/timeline",
    response_model=TimelineResponse,
    tags=["tracking"],
)
def application_timeline(
    public_id: str,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> TimelineResponse:
    application = get_application_by_public_id(db, public_id)
    require_application_owner(current_user, application)
    return timeline(db, public_id)


@router.post("/api/agent/chat", response_model=AgentChatResponse, tags=["agent"])
def agent_chat(
    payload: AgentChatRequest,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> AgentChatResponse:
    require_user(current_user, payload.user_id)
    return chat(
        db,
        user_id=payload.user_id,
        public_id=payload.application_id,
        message=payload.message,
    )


@router.post("/api/agent/chat/stream", tags=["agent"])
def agent_chat_stream(
    payload: AgentChatRequest,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    require_user(current_user, payload.user_id)
    if payload.application_id:
        application = get_application_by_public_id(db, payload.application_id)
        require_application_owner(current_user, application)

    def event_source():
        for event in stream_chat_events(
            db,
            user_id=payload.user_id,
            public_id=payload.application_id,
            message=payload.message,
        ):
            event_name = str(event["type"])
            data = {key: value for key, value in event.items() if key != "type"}
            yield f"event: {event_name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/api/agent/history",
    response_model=AgentHistoryResponse,
    tags=["agent"],
)
def agent_history(
    application_id: str = Query(min_length=1, max_length=32),
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> AgentHistoryResponse:
    return AgentHistoryResponse(
        messages=history(db, user_id=current_user.id, public_id=application_id)
    )


@router.post("/api/policy/search", response_model=PolicyAnswer, tags=["policy"])
def policy_search(payload: PolicyQuery, db: Session = Depends(get_db)) -> PolicyAnswer:
    return answer_policy_question(db, payload.query, top_k=payload.top_k)


@router.get("/api/safety/modules", response_model=list[SafetyModuleRead], tags=["safety"])
def safety_modules(
    _: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> list[SafetyModuleRead]:
    return list_modules(db)


@router.get(
    "/api/users/{user_id}/safety-progress",
    response_model=SafetyProgressResponse,
    tags=["safety"],
)
def safety_progress(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> SafetyProgressResponse:
    require_user(current_user, user_id)
    return get_safety_progress(db, user_id)


@router.post(
    "/api/safety/modules/{module_id}/answer",
    response_model=SafetyAnswerResult,
    tags=["safety"],
)
def answer_safety_module(
    module_id: uuid.UUID,
    payload: SafetyAnswerRequest,
    current_user: User = Depends(get_current_demo_user),
    db: Session = Depends(get_db),
) -> SafetyAnswerResult:
    require_user(current_user, payload.user_id)
    return answer_module(db, user_id=payload.user_id, module_id=module_id, answer=payload.answer)


@router.get("/api/admin/stats", response_model=AdminStats, tags=["admin"])
def reviewer_stats(db: Session = Depends(get_db)) -> AdminStats:
    return admin_stats(db)


@router.get(
    "/api/admin/applications",
    response_model=AdminApplicationsResponse,
    tags=["admin"],
)
def reviewer_applications(
    status: ApplicationStatus | None = None,
    product: str | None = Query(default=None, max_length=120),
    risk_level: RiskLevel | None = None,
    search: str | None = Query(default=None, max_length=160),
    limit: int = Query(default=100, ge=1, le=250),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> AdminApplicationsResponse:
    return admin_applications(
        db,
        status=status,
        product=product,
        risk_level=risk_level,
        search=search,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/api/admin/applications/{public_id}",
    response_model=ApplicationDetail,
    tags=["admin"],
)
def reviewer_application(public_id: str, db: Session = Depends(get_db)) -> ApplicationDetail:
    return application_detail(db, public_id)


@router.post(
    "/api/admin/applications/{public_id}/verify",
    response_model=ApplicationDetail,
    tags=["admin"],
)
def reviewer_verify(public_id: str, db: Session = Depends(get_db)) -> ApplicationDetail:
    application = get_application_by_public_id(db, public_id, for_update=True)
    run_verification(db, application)
    db.commit()
    return application_detail(db, public_id)


@router.post(
    "/api/admin/applications/{public_id}/approve",
    response_model=ApplicationDetail,
    tags=["admin"],
)
def reviewer_approve(
    public_id: str,
    payload: ReviewerActionRequest,
    db: Session = Depends(get_db),
) -> ApplicationDetail:
    application = get_application_by_public_id(db, public_id, for_update=True)
    approve_application(
        db,
        application,
        reviewer_identifier="demo-reviewer",
        reason=payload.reason,
        override_review_flag=payload.override_review_flag,
    )
    db.commit()
    return application_detail(db, public_id)


@router.post(
    "/api/admin/applications/{public_id}/reject",
    response_model=ApplicationDetail,
    tags=["admin"],
)
def reviewer_reject(
    public_id: str,
    payload: ReviewerActionRequest,
    db: Session = Depends(get_db),
) -> ApplicationDetail:
    application = get_application_by_public_id(db, public_id, for_update=True)
    reject_application(
        db,
        application,
        reviewer_identifier="demo-reviewer",
        reason=payload.reason,
    )
    db.commit()
    return application_detail(db, public_id)


@router.post(
    "/api/admin/applications/{public_id}/request-info",
    response_model=ApplicationDetail,
    tags=["admin"],
)
def reviewer_request_information(
    public_id: str,
    payload: ReviewerActionRequest,
    db: Session = Depends(get_db),
) -> ApplicationDetail:
    application = get_application_by_public_id(db, public_id, for_update=True)
    request_more_information(
        db,
        application,
        reviewer_identifier="demo-reviewer",
        reason=payload.reason,
    )
    db.commit()
    return application_detail(db, public_id)


@router.post(
    "/api/admin/applications/{public_id}/process-payment",
    response_model=PaymentRead,
    tags=["admin"],
)
def reviewer_process_payment(public_id: str, db: Session = Depends(get_db)) -> PaymentRead:
    application = get_application_by_public_id(db, public_id, for_update=True)
    payment = process_payment(db, application, actor_identifier="demo-reviewer/mock-treasury")
    db.commit()
    db.refresh(payment)
    return PaymentRead.model_validate(payment)
