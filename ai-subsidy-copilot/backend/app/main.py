"""FastAPI entry point for the fictional AI Subsidy Copilot demo."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.router import router
from app.core.config import settings
from app.core.database import SessionLocal, init_db
from app.core.errors import DomainError
from app.services.demo import seed_demo_data


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    settings.receipt_storage_dir.mkdir(parents=True, exist_ok=True)
    if settings.demo_mode:
        with SessionLocal() as db:
            seed_demo_data(db, ingest_policy=True)
    yield


app = FastAPI(
    title="AI Subsidy Copilot API",
    version="0.1.0",
    description=(
        "Backend for a fictional government subsidy demonstration. AI assists; deterministic "
        "rules determine eligibility; authorized services control mock payment."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "Authorization"],
)


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.as_dict())


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors: list[dict[str, Any]] = []
    for item in exc.errors():
        errors.append(
            {
                "field": ".".join(str(part) for part in item.get("loc", ())[1:]),
                "message": item.get("msg", "Invalid value"),
                "type": item.get("type"),
            }
        )
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed.",
                "details": {"fields": errors},
            }
        },
    )


@app.get("/health", tags=["health"])
def health() -> dict[str, object]:
    database = "disconnected"
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        database = "connected"
    except Exception:
        pass
    return {
        "status": "ok" if database == "connected" else "degraded",
        "database": database,
        "demo_mode": settings.demo_mode,
        "openai_configured": settings.openai_configured,
        "gemini_configured": settings.gemini_configured,
        "ai_configured": settings.ai_configured,
        "ai_provider": settings.active_ai_provider or "fallback",
        "ai_model": settings.active_ai_model,
    }


app.include_router(router)
