from pathlib import Path
from secrets import token_urlsafe


def main():
    target = Path(".env")
    if target.exists():
        raise SystemExit(".env already exists. It has not been changed.")
    target.write_text(
        "DB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=flashmarket\n"
        "DB_USER=flashmarket\n"
        f"DB_PASSWORD={token_urlsafe(24)}\n"
        f"DB_ROOT_PASSWORD={token_urlsafe(24)}\n"
        f"ADMIN_API_KEY={token_urlsafe(32)}\n"
        "DB_POOL_SIZE=10\nSSE_MAX_CLIENTS=32\n",
        encoding="utf-8",
    )
    target.chmod(0o600)
    print("Created .env with random local credentials. Secret values are not printed.")
    print("Docker: docker compose up --build")
    print("Native MySQL: edit DB_* to match a database and account you created.")


if __name__ == "__main__":
    main()
