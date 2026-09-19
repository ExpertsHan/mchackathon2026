"""SQLAlchemy engine and request-session lifecycle."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.models.base import Base


def _engine_options(database_url: str) -> dict[str, object]:
    options: dict[str, object] = {"pool_pre_ping": True}
    if database_url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
    return options


engine = create_engine(settings.database_url, **_engine_options(settings.database_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection: object, _: object) -> None:
    if dbapi_connection.__class__.__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    # Importing registers all model tables on Base.metadata.
    import app.models  # noqa: F401

    if engine.dialect.name == "postgresql":
        # The Docker database image includes pgvector; keep extension activation
        # explicit and idempotent for normal PostgreSQL installations.
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """Additive, idempotent column upgrade for databases created by an older release.

    ``create_all`` never alters existing tables. Only nullable/defaulted columns are
    added, so existing rows stay valid and no data is rewritten.
    """

    inspector = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if not inspector.has_table(table.name):
            continue
        present = {column["name"] for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in present or column.primary_key:
                continue
            column_type = column.type.compile(dialect=engine.dialect)
            default = ""
            if not column.nullable:
                if isinstance(column.default.arg if column.default is not None else None, bool):
                    default = f" DEFAULT {'TRUE' if column.default.arg else 'FALSE'}"
                else:
                    continue  # Cannot add a NOT NULL column without a safe default.
            statement = (
                f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column_type}{default}'
            )
            with engine.begin() as connection:
                connection.execute(text(statement))


__all__ = ["Base", "SessionLocal", "engine", "get_db", "init_db", "session_scope"]
