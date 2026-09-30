from dataclasses import dataclass

from app.schemas import CatalogFilters


SORTS = {
    "newest": "p.created_at DESC, p.id DESC",
    "name": "p.name ASC, p.id ASC",
    "price_asc": "p.price ASC, p.id ASC",
    "price_desc": "p.price DESC, p.id ASC",
    "rating_desc": "p.rating DESC, p.id ASC",
    "stock_desc": "p.stock DESC, p.id ASC",
}

PRODUCT_COLUMNS = """
    p.id, p.sku, p.name, p.description, p.category_id, c.name AS category,
    p.brand_id, b.name AS brand, p.price, p.stock, p.rating, p.version,
    p.is_sample, p.created_at, p.updated_at
"""
PRODUCT_JOINS = """
    FROM products p
    JOIN brands b ON b.id = p.brand_id
    JOIN categories c ON c.id = p.category_id
"""
CATEGORY_CTE = """
WITH RECURSIVE category_tree AS (
    SELECT id, 1 AS traversal_depth FROM categories WHERE id = %s
    UNION ALL
    SELECT c.id, t.traversal_depth + 1
    FROM categories c JOIN category_tree t ON c.parent_id = t.id
    WHERE t.traversal_depth < 3
)
"""


@dataclass(frozen=True)
class BuiltQuery:
    sql: str
    params: tuple
    count_sql: str
    count_params: tuple


def escape_like(value: str) -> str:
    """'=' is the explicit SQL LIKE escape, independent of SQL mode/backslashes."""
    return value.replace("=", "==").replace("%", "=%").replace("_", "=_")


def build_catalog_query(filters: CatalogFilters) -> BuiltQuery:
    clauses = ["p.is_active = 1"]
    params = []
    cte = ""
    if filters.category_id is not None:
        cte = CATEGORY_CTE
        params.append(filters.category_id)
        clauses.append("p.category_id IN (SELECT id FROM category_tree)")
    if filters.search:
        clauses.append("(p.name LIKE %s ESCAPE '=' OR p.sku LIKE %s ESCAPE '=' OR b.name LIKE %s ESCAPE '=')")
        pattern = f"%{escape_like(filters.search)}%"
        params.extend([pattern] * 3)
    if filters.brand_id:
        clauses.append(f"p.brand_id IN ({', '.join(['%s'] * len(filters.brand_id))})")
        params.extend(filters.brand_id)
    if filters.min_price is not None:
        clauses.append("p.price >= %s")
        params.append(filters.min_price)
    if filters.max_price is not None:
        clauses.append("p.price <= %s")
        params.append(filters.max_price)
    if filters.min_rating is not None:
        clauses.append("p.rating >= %s")
        params.append(filters.min_rating)
    stock_predicates = {
        "all": None,
        "in": "p.stock > 0",
        "low": "p.stock BETWEEN 1 AND 5",
        "out": "p.stock = 0",
    }
    if stock_predicates[filters.stock]:
        clauses.append(stock_predicates[filters.stock])
    where = " WHERE " + " AND ".join(clauses)
    # Only trusted identifiers/fragments are interpolated. Values are always bound.
    sql = cte + "SELECT " + PRODUCT_COLUMNS + PRODUCT_JOINS + where
    sql += f" ORDER BY {SORTS[filters.sort]} LIMIT %s OFFSET %s"
    count_sql = cte + "SELECT COUNT(*) AS total " + PRODUCT_JOINS + where
    return BuiltQuery(
        sql=sql,
        params=tuple(params + [filters.limit, filters.offset]),
        count_sql=count_sql,
        count_params=tuple(params),
    )
