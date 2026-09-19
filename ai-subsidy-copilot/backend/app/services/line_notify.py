"""Best-effort LINE push notifications, sent from the FastAPI side of the integration.

Notifications are a convenience: a missing token, an unbound citizen or a LINE outage
must never fail or roll back a workflow step.
"""

from __future__ import annotations

import json
import logging
import ssl
import urllib.request

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import ActorType
from app.models import Application, LineBinding
from app.services.audit import record_audit

logger = logging.getLogger(__name__)


def _ssl_context() -> ssl.SSLContext:
    # macOS python.org builds ship without a CA bundle; prefer certifi when installed.
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


PUSH_URL = "https://api.line.me/v2/bot/message/push"

STATUS_TEXT = {
    "MANUAL_REVIEW": "您的補助申請已送出（受理編號：{id}），將進入審核程序。",
    "REQUESTED_INFORMATION": "您的補助申請（受理編號：{id}）需要補件：\n{detail}",
    "APPROVED": "恭喜！您的補助申請（受理編號：{id}）已核准，將盡快安排撥款作業。\n\n審核說明：{detail}",
    "REJECTED": "很抱歉，您的補助申請（受理編號：{id}）經審核後未通過。\n\n原因：{detail}\n\n如有疑問請洽承辦單位。",
    "PAID": "您的補助款（受理編號：{id}）已完成撥款，請留意帳戶入帳狀況。",
    "CANCELLED": "您的補助申請（受理編號：{id}）已取消。",
}


def _push(line_user_id: str, text: str) -> None:
    request = urllib.request.Request(  # noqa: S310 - fixed https endpoint
        PUSH_URL,
        data=json.dumps(
            {"to": line_user_id, "messages": [{"type": "text", "text": text[:4900]}]}
        ).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.line_channel_access_token}",
        },
        method="POST",
    )
    urllib.request.urlopen(request, timeout=5, context=_ssl_context()).close()  # noqa: S310


def notify_applicant(
    db: Session, application: Application, text: str, *, actor_identifier: str = "system"
) -> bool:
    """Push ``text`` to the applicant's bound LINE account. Returns whether it was sent."""

    if not settings.line_channel_access_token:
        return False
    binding = db.get(LineBinding, application.user_id)
    if binding is None:
        return False
    try:
        _push(binding.line_user_id, text)
    except Exception:  # network, HTTP and encoding failures are all non-fatal here
        logger.warning("LINE push failed for application %s", application.public_id, exc_info=True)
        return False
    record_audit(
        db,
        "LINE_NOTIFICATION_SENT",
        ActorType.SYSTEM,
        actor_identifier,
        application=application,
        details={"length": len(text)},
    )
    return True


def notify_status(db: Session, application: Application, *, detail: str = "") -> bool:
    template = STATUS_TEXT.get(application.status.value)
    if template is None:
        return False
    return notify_applicant(
        db,
        application,
        template.format(id=application.public_id, detail=detail),
        actor_identifier="status-notifier",
    )
