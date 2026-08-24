from app.core.database import init_db


def main() -> None:
    init_db()
    print("Database schema initialized.")


if __name__ == "__main__":
    main()
