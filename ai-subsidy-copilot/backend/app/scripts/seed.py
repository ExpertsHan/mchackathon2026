from app.core.database import init_db, session_scope
from app.services.demo import seed_demo_data


def main() -> None:
    init_db()
    with session_scope() as db:
        seed_demo_data(db, ingest_policy=True)
    print("Demo users, safety modules, scenario data, and policy were seeded.")


if __name__ == "__main__":
    main()
