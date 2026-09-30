import json

from app.db import Database
from app.query_builder import PRODUCT_COLUMNS, PRODUCT_JOINS, build_catalog_query
from app.schemas import CatalogFilters, ProductCreate, ProductPatch, StockUpdate


class DomainError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(detail)


class CatalogRepository:
    def __init__(self, database: Database):
        self.database = database

    def health(self):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT VERSION() AS mysql_version")
            return {"status": "ok", "database": "mysql", **cursor.fetchone()}

    def list_products(self, filters: CatalogFilters):
        query = build_catalog_query(filters)
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            # Same repeatable-read snapshot for count and rows.
            cursor.execute(query.count_sql, query.count_params)
            total = cursor.fetchone()["total"]
            cursor.execute(query.sql, query.params)
            items = cursor.fetchall()
        return {"items": items, "total": total, "limit": filters.limit, "offset": filters.offset}

    def get_product(self, product_id: int):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT " + PRODUCT_COLUMNS + PRODUCT_JOINS + " WHERE p.id = %s AND p.is_active = 1",
                (product_id,),
            )
            product = cursor.fetchone()
        if not product:
            raise DomainError(404, "Product not found")
        return product

    def stats(self):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            cursor.execute("""
                SELECT COUNT(*) AS total_products,
                    COALESCE(SUM(stock > 0), 0) AS in_stock,
                    COALESCE(SUM(stock BETWEEN 1 AND 5), 0) AS low_stock,
                    COALESCE(SUM(stock = 0), 0) AS out_of_stock,
                    COALESCE(SUM(stock), 0) AS total_units,
                    COALESCE(SUM(price * stock), 0) AS inventory_value,
                    COALESCE(SUM(is_sample), 0) AS sample_products
                FROM products WHERE is_active = 1
            """)
            row = cursor.fetchone()
        return {key: float(value) if key == "inventory_value" else int(value) for key, value in row.items()}

    def categories(self):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            cursor.execute("""
                WITH RECURSIVE paths AS (
                    SELECT id, name, parent_id, depth, CAST(name AS CHAR(512)) AS path
                    FROM categories WHERE parent_id IS NULL
                    UNION ALL
                    SELECT c.id, c.name, c.parent_id, c.depth, CONCAT(p.path, ' / ', c.name)
                    FROM categories c JOIN paths p ON c.parent_id = p.id
                    WHERE p.depth < 3
                )
                SELECT id, name, parent_id, depth, path FROM paths ORDER BY path
            """)
            return cursor.fetchall()

    def brands(self):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT id, name FROM brands ORDER BY name")
            return cursor.fetchall()

    @staticmethod
    def _validate_references(cursor, category_id=None, brand_id=None):
        if category_id is not None:
            cursor.execute("SELECT depth FROM categories WHERE id = %s", (category_id,))
            category = cursor.fetchone()
            if not category:
                raise DomainError(422, "Unknown category")
            if category["depth"] != 3:
                raise DomainError(422, "Assign products to a third-level category")
        if brand_id is not None:
            cursor.execute("SELECT id FROM brands WHERE id = %s", (brand_id,))
            if not cursor.fetchone():
                raise DomainError(422, "Unknown brand")

    @staticmethod
    def _record_event(cursor, product_id, event_type, payload):
        cursor.execute(
            "INSERT INTO inventory_events (product_id, event_type, payload) VALUES (%s, %s, %s)",
            (product_id, event_type, json.dumps(payload)),
        )

    @staticmethod
    def _locked_product(cursor, product_id, expected_version):
        cursor.execute(
            "SELECT id, stock, version FROM products WHERE id = %s AND is_active = 1 FOR UPDATE",
            (product_id,),
        )
        product = cursor.fetchone()
        if not product:
            raise DomainError(404, "Product not found")
        if product["version"] != expected_version:
            raise DomainError(409, "Product changed in another session. Reload it and try again.")
        return product

    def create_product(self, payload: ProductCreate):
        values = payload.model_dump()
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            self._validate_references(cursor, payload.category_id, payload.brand_id)
            cursor.execute("""
                INSERT INTO products
                (sku, name, description, category_id, brand_id, price, stock, rating, is_sample)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 0)
            """, tuple(values[key] for key in (
                "sku", "name", "description", "category_id", "brand_id", "price", "stock", "rating"
            )))
            product_id = cursor.lastrowid
            self._record_event(cursor, product_id, "catalog", {"product_id": product_id, "action": "created"})
            connection.commit()
        return self.get_product(product_id)

    def patch_product(self, product_id: int, payload: ProductPatch):
        values = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
        # Pydantic's extra="forbid" limits keys to known, editable column names.
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            self._locked_product(cursor, product_id, payload.expected_version)
            self._validate_references(cursor, values.get("category_id"), values.get("brand_id"))
            assignments = ", ".join(f"{column} = %s" for column in values)
            cursor.execute(
                f"UPDATE products SET {assignments}, version = version + 1 WHERE id = %s",
                (*values.values(), product_id),
            )
            self._record_event(cursor, product_id, "catalog", {"product_id": product_id, "action": "updated"})
            connection.commit()
        return self.get_product(product_id)

    def update_stock(self, product_id: int, payload: StockUpdate):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            previous = self._locked_product(cursor, product_id, payload.expected_version)
            cursor.execute(
                "UPDATE products SET stock = %s, version = version + 1 WHERE id = %s",
                (payload.stock, product_id),
            )
            self._record_event(cursor, product_id, "stock", {
                "product_id": product_id,
                "stock_before": previous["stock"],
                "stock": payload.stock,
                "version": previous["version"] + 1,
                "reason": payload.reason,
            })
            # The event and the stock change either both commit or both roll back.
            connection.commit()
        return self.get_product(product_id)

    def archive_product(self, product_id: int, expected_version: int):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            self._locked_product(cursor, product_id, expected_version)
            cursor.execute(
                "UPDATE products SET is_active = 0, version = version + 1 WHERE id = %s",
                (product_id,),
            )
            self._record_event(cursor, product_id, "catalog", {"product_id": product_id, "action": "archived"})
            connection.commit()

    def event_cursor(self):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            cursor.execute("SELECT COALESCE(MAX(id), 0) AS latest_event_id FROM inventory_events")
            return int(cursor.fetchone()["latest_event_id"])

    def events_after(self, event_id: int):
        with self.database.connection() as connection, connection.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT id, event_type, payload FROM inventory_events WHERE id > %s ORDER BY id LIMIT 100",
                (event_id,),
            )
            events = cursor.fetchall()
        for event in events:
            if isinstance(event["payload"], str):
                event["payload"] = json.loads(event["payload"])
        return events
