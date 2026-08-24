"""Relational domain model for citizens, applications, evidence, and policy."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.core.enums import (
    ActorType,
    ApplicationStatus,
    EligibilityOutcome,
    PaymentStatus,
    RiskLevel,
)
from app.models.base import Base, utcnow


class PortableVector(TypeDecorator[list[float]]):
    """Use pgvector on PostgreSQL and JSON everywhere else (notably unit tests)."""

    impl = JSON
    cache_ok = True

    def __init__(self, dimensions: int = 1536) -> None:
        super().__init__()
        self.dimensions = dimensions

    def load_dialect_impl(self, dialect: Any) -> Any:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(self.dimensions))
        return dialect.type_descriptor(JSON())


def _enum(enum_type: type[Any], *, name: str) -> SAEnum:
    return SAEnum(
        enum_type,
        name=name,
        native_enum=False,
        validate_strings=True,
        values_callable=lambda values: [value.value for value in values],
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    government_id_masked: Mapped[str] = mapped_column(String(40), nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    identity_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    applications: Mapped[list[Application]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    subscriptions: Mapped[list[Subscription]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    safety_progress: Mapped[list[SafetyProgress]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str | None] = mapped_column(String(120))
    product: Mapped[str | None] = mapped_column(String(120), index=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    amount_twd: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    purchase_date: Mapped[date | None] = mapped_column(Date, index=True)
    receipt_filename: Mapped[str | None] = mapped_column(String(255))
    receipt_storage_path: Mapped[str | None] = mapped_column(String(500))
    receipt_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    receipt_reference: Mapped[str | None] = mapped_column(String(160), index=True)
    account_email: Mapped[str | None] = mapped_column(String(255))
    extraction_confidence: Mapped[float | None] = mapped_column(Float)
    extraction_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    extraction_warnings_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    suspicious_content: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    user: Mapped[User] = relationship(back_populates="subscriptions")
    application: Mapped[Application | None] = relationship(
        back_populates="subscription", uselist=False
    )


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    public_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="SET NULL"), unique=True
    )
    requested_amount_twd: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    approved_amount_twd: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    eligibility_result: Mapped[EligibilityOutcome | None] = mapped_column(
        _enum(EligibilityOutcome, name="eligibility_outcome"), nullable=True
    )
    eligibility_reasons_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, nullable=False
    )
    policy_citations_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, default=list, nullable=False
    )
    risk_level: Mapped[RiskLevel] = mapped_column(
        _enum(RiskLevel, name="risk_level"), nullable=False, default=RiskLevel.LOW
    )
    risk_reasons_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[ApplicationStatus] = mapped_column(
        _enum(ApplicationStatus, name="application_status"),
        nullable=False,
        default=ApplicationStatus.DRAFT,
        index=True,
    )
    reviewer_reason: Mapped[str | None] = mapped_column(Text)
    information_request: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    user: Mapped[User] = relationship(back_populates="applications")
    subscription: Mapped[Subscription | None] = relationship(back_populates="application")
    payment: Mapped[Payment | None] = relationship(
        back_populates="application", cascade="all, delete-orphan", uselist=False
    )
    audit_logs: Mapped[list[AuditLog]] = relationship(
        back_populates="application",
        cascade="all, delete-orphan",
        order_by="AuditLog.created_at",
    )
    agent_session: Mapped[AgentSession | None] = relationship(
        back_populates="application", cascade="all, delete-orphan", uselist=False
    )


class SafetyModule(Base):
    __tablename__ = "safety_modules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    choices_json: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
    correct_answer: Mapped[str] = mapped_column(String(20), nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)

    progress: Mapped[list[SafetyProgress]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )


class SafetyProgress(Base):
    __tablename__ = "safety_progress"
    __table_args__ = (UniqueConstraint("user_id", "module_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    module_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("safety_modules.id", ondelete="CASCADE"), nullable=False
    )
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="safety_progress")
    module: Mapped[SafetyModule] = relationship(back_populates="progress")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applications.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    amount_twd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(
        _enum(PaymentStatus, name="payment_status"), nullable=False
    )
    transaction_id: Mapped[str | None] = mapped_column(String(80), unique=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    application: Mapped[Application] = relationship(back_populates="payment")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    actor_type: Mapped[ActorType] = mapped_column(
        _enum(ActorType, name="actor_type"), nullable=False
    )
    actor_identifier: Mapped[str] = mapped_column(String(160), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    details_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )

    application: Mapped[Application | None] = relationship(back_populates="audit_logs")


class PolicyDocument(Base):
    __tablename__ = "policy_documents"
    __table_args__ = (Index("ix_policy_document_effective", "effective_from", "effective_to"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    section: Mapped[str] = mapped_column(String(255), nullable=False)
    article: Mapped[str | None] = mapped_column(String(100))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(PortableVector(1536))
    effective_from: Mapped[date | None] = mapped_column(Date)
    effective_to: Mapped[date | None] = mapped_column(Date)
    version: Mapped[str] = mapped_column(String(80), nullable=False, default="2026.1")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    state_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    messages_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    application: Mapped[Application] = relationship(back_populates="agent_session")


class ApplicationIdSequence(Base):
    """Per-year counter used to issue friendly public IDs inside a transaction."""

    __tablename__ = "application_id_sequences"

    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ClaimReservation(Base):
    """Unique database-backed claim key used to serialize final approvals."""

    __tablename__ = "claim_reservations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reservation_key: Mapped[str] = mapped_column(String(180), nullable=False, unique=True)
    application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("applications.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
