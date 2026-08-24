from app.core.config import settings
from app.core.database import init_db, session_scope
from app.rag.ingestion import ingest_knowledge


def main() -> None:
    init_db()
    with session_scope() as db:
        count = ingest_knowledge(db, settings.knowledge_dir, replace=True)
    print(f"Ingested {count} policy chunks from {settings.knowledge_dir}.")


if __name__ == "__main__":
    main()
