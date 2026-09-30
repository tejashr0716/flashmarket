import json
from pathlib import Path

from app.config import Settings
from app.db import Database
from app.query_builder import build_catalog_query
from app.schemas import CatalogFilters


def main():
    database = Database(Settings.from_env())
    query = build_catalog_query(CatalogFilters(
        brand_id=[1], min_price="1000", max_price="80000", stock="in", min_rating="3.5", sort="price_asc"
    ))
    try:
        with database.connection() as connection, connection.cursor() as cursor:
            cursor.execute("EXPLAIN FORMAT=JSON " + query.sql, query.params)
            plan = json.loads(cursor.fetchone()[0])
        target = Path("reports/explain.json")
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(plan, indent=2) + "\n")
        print(f"Saved the actual MySQL optimizer plan to {target}")
    finally:
        database.close()


if __name__ == "__main__":
    main()
