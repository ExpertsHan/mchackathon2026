"""Environment-backed configuration for the demo service."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Runtime settings.

    The SQLite default makes the structured demo usable without external services.
    Docker and the documented production-like path use PostgreSQL + pgvector via
    ``DATABASE_URL``.
    """

    app_name: str = "AI Subsidy Copilot"
    app_env: str = "development"
    demo_mode: bool = True
    demo_auth_secret: str = "local-demo-only-change-me"
    database_url: str = f"sqlite:///{BACKEND_ROOT / 'ai_subsidy_demo.db'}"

    openai_api_key: str = ""
    openai_model: str = ""
    openai_embedding_model: str = ""

    frontend_origin: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    receipt_storage_dir: Path = BACKEND_ROOT / "storage" / "receipts"
    knowledge_dir: Path = BACKEND_ROOT.parent / "knowledge"
    demo_receipts_dir: Path = BACKEND_ROOT.parent / "demo" / "receipts"
    max_receipt_bytes: int = Field(default=10 * 1024 * 1024, ge=1)
    max_pdf_pages: int = Field(default=10, ge=1, le=100)
    max_extracted_chars: int = Field(default=50_000, ge=1_000, le=1_000_000)

    program_effective_from: date = date(2026, 1, 1)
    program_effective_to: date = date(2026, 12, 31)
    maximum_subsidy_twd: Decimal = Decimal("600")
    minimum_extraction_confidence: float = Field(default=0.75, ge=0, le=1)
    embedding_dimensions: int = Field(default=1536, ge=1)

    model_config = SettingsConfigDict(
        env_file=(BACKEND_ROOT / ".env", BACKEND_ROOT.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key and self.openai_model)

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def mock_exchange_rates(self) -> dict[str, Decimal]:
        return {
            "TWD": Decimal("1"),
            "USD": Decimal("30"),
            "EUR": Decimal("32"),
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
