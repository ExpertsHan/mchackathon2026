from __future__ import annotations

import threading
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, selectinload

from app.models import Application, Base, Subscription, User
from app.services.claim_reservations import reserve_claim_keys


def test_two_sessions_cannot_reserve_same_user_month(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'claims.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Base.metadata.create_all(engine)
    user_id = uuid.uuid4()
    application_ids: list[uuid.UUID] = []
    with Session(engine) as setup:
        setup.add(
            User(
                id=user_id,
                name="Concurrent Citizen",
                government_id_masked="D45****000",
                age=30,
                email="concurrent@example.test",
                identity_verified=True,
            )
        )
        for index in range(2):
            receipt_hash = str(index + 1) * 64
            subscription = Subscription(
                user_id=user_id,
                provider="OpenAI",
                product="ChatGPT Plus",
                amount=Decimal("20"),
                currency="USD",
                amount_twd=Decimal("600"),
                purchase_date=date(2026, 9, 3 + index),
                receipt_hash=receipt_hash,
                extraction_confidence=1,
                extraction_json={
                    "provider": "OpenAI",
                    "product": "ChatGPT Plus",
                    "amount": "20",
                    "currency": "USD",
                    "purchase_date": f"2026-09-0{3 + index}",
                    "confidence": 1,
                },
            )
            setup.add(subscription)
            setup.flush()
            application = Application(
                public_id=f"AI-2026-90000{index}",
                user_id=user_id,
                subscription_id=subscription.id,
            )
            setup.add(application)
            setup.flush()
            application_ids.append(application.id)
        setup.commit()

    barrier = threading.Barrier(2)
    results: list[list[str]] = []
    errors: list[Exception] = []

    def worker(application_id: uuid.UUID) -> None:
        try:
            with Session(engine) as db:
                application = db.scalar(
                    select(Application)
                    .where(Application.id == application_id)
                    .options(selectinload(Application.subscription))
                )
                assert application is not None
                barrier.wait(timeout=5)
                conflicts = reserve_claim_keys(db, application)
                db.commit()
                results.append(conflicts)
        except Exception as exc:  # pragma: no cover - asserted below for thread visibility
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(item,)) for item in application_ids]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert errors == []
    assert len(results) == 2
    assert sum(not conflicts for conflicts in results) == 1
    loser = next(conflicts for conflicts in results if conflicts)
    assert any(key.startswith(f"MONTH:{user_id}:2026-09") for key in loser)
