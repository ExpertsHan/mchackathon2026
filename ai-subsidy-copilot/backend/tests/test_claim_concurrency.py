from __future__ import annotations

import threading
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.models import Application, Base, SourceDocument, User
from app.services.claim_reservations import reserve_claim_keys


def test_two_sessions_cannot_reserve_the_same_receipt(tmp_path) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'claims.db'}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    Base.metadata.create_all(engine)
    application_ids: list[uuid.UUID] = []
    shared_hash = "a" * 64
    with Session(engine) as setup:
        for index in range(2):
            user = User(
                id=uuid.uuid4(),
                name=f"Concurrent Citizen {index}",
                government_id_masked="D45****000",
                age=30,
                email=f"concurrent{index}@example.test",
                identity_verified=True,
            )
            setup.add(user)
            setup.flush()
            application = Application(public_id=f"AI-2026-90000{index}", user_id=user.id)
            setup.add(application)
            setup.flush()
            setup.add(
                SourceDocument(
                    application_id=application.id,
                    document_type="receipt",
                    original_filename="receipt.pdf",
                    storage_filename=f"{index}.pdf",
                    content_type="application/pdf",
                    size_bytes=1,
                    sha256=shared_hash,
                    ocr_status="done",
                    ocr_data={},
                )
            )
            application_ids.append(application.id)
        setup.commit()

    barrier = threading.Barrier(2)
    results: list[list[str]] = []
    errors: list[Exception] = []

    def worker(application_id: uuid.UUID) -> None:
        try:
            with Session(engine) as db:
                application = db.scalar(select(Application).where(Application.id == application_id))
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
    assert f"RECEIPT:{shared_hash}" in loser
