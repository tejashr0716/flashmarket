import argparse
import time
from pathlib import Path

from mysql.connector import Error

from app.config import Settings
from app.db import Database
from scripts.seed import seed_catalog


def apply_schema(database):
    sql = (Path(__file__).resolve().parents[1] / "database" / "schema.sql").read_text(encoding="utf-8")
    # Schema v1 has no stored routines or semicolons in strings.
    sql = "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))
    with database.connection() as connection, connection.cursor() as cursor:
        for statement in sql.split(";"):
            if statement.strip():
                cursor.execute(statement)
        connection.commit()


def main():
    parser = argparse.ArgumentParser(description="Add schema v1 without dropping or resetting data")
    parser.add_argument("--seed", action="store_true", help="Seed a new database once, without overwriting data")
    args = parser.parse_args()
    settings = Settings.from_env()
    database = None
    for attempt in range(30):
        try:
            database = Database(settings)
            break
        except Error:
            if attempt == 29:
                raise SystemExit("Could not connect to MySQL. Check DB_* or DATABASE_URL and database availability.")
            time.sleep(2)
    try:
        apply_schema(database)
        print("Schema v1 ready. Existing tables and records were preserved.")
        if args.seed:
            print("Inserted 600 sample products." if seed_catalog(database) else "Sample seed already applied; skipped.")
    finally:
        database.close()


if __name__ == "__main__":
    main()
