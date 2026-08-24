from app.core.config import settings
from app.core.database import init_db, session_scope
from app.services.demo import reset_demo_data


def main() -> None:
    if not settings.demo_mode:
        raise SystemExit("Reset is available only when DEMO_MODE=true.")
    init_db()
    with session_scope() as db:
        reset_demo_data(db)
    print("Demo database reset complete.")


if __name__ == "__main__":
    main()
