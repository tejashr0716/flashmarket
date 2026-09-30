from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.main import format_event, parse_event_id
from app.query_builder import SORTS, build_catalog_query, escape_like
from app.schemas import CatalogFilters, ProductCreate, ProductPatch, StockUpdate
from scripts.seed import sample_records


def test_default_query_is_bounded_and_stable():
    query = build_catalog_query(CatalogFilters())
    assert query.params == (100, 0)
    assert query.count_params == ()
    assert "p.is_active = 1" in query.sql
    assert "p.created_at DESC, p.id DESC" in query.sql


def test_four_facets_are_combined_with_bound_parameters():
    query = build_catalog_query(CatalogFilters(
        min_price="1000", max_price="80000", stock="in", brand_id=[2, 3],
        min_rating="3.5", limit=20, offset=40,
    ))
    assert "p.brand_id IN (%s, %s)" in query.sql
    assert "p.price >= %s" in query.sql and "p.price <= %s" in query.sql
    assert "p.stock > 0" in query.sql and "p.rating >= %s" in query.sql
    assert query.params == (2, 3, Decimal("1000"), Decimal("80000"), Decimal("3.5"), 20, 40)
    assert query.count_params == query.params[:-2]


def test_category_filter_uses_recursive_cte():
    query = build_catalog_query(CatalogFilters(category_id=1, search="laptop"))
    assert "WITH RECURSIVE category_tree" in query.sql
    assert "c.parent_id = t.id" in query.sql
    assert query.params[0] == 1 and query.count_params[0] == 1
    assert query.sql.startswith(query.count_sql.split("SELECT COUNT(*)")[0])


@pytest.mark.parametrize("payload", ["' OR 1=1 --", "x'; DROP TABLE products; --", "%_="])
def test_search_cannot_become_sql(payload):
    query = build_catalog_query(CatalogFilters(search=payload))
    assert payload not in query.sql
    assert query.params[0] == f"%{escape_like(payload)}%"


def test_like_wildcards_are_literals():
    assert escape_like("50%_off=now") == "50=%=_off==now"


@pytest.mark.parametrize("sort", list(SORTS))
def test_sort_uses_allowlisted_sql(sort):
    query = build_catalog_query(CatalogFilters(sort=sort))
    assert f"ORDER BY {SORTS[sort]}" in query.sql


@pytest.mark.parametrize("values", [
    {"sort": "price; DROP TABLE products"}, {"stock": "anything"},
    {"min_price": -1}, {"min_price": "100.001"}, {"min_price": 100, "max_price": 50},
    {"min_rating": 5.1}, {"limit": 1001}, {"offset": -1}, {"brand_id": [0]},
    {"category_id": 0}, {"unexpected": "ignored?"},
])
def test_invalid_filters_are_rejected(values):
    with pytest.raises(ValidationError):
        CatalogFilters(**values)


def test_brands_are_deduplicated():
    assert CatalogFilters(brand_id=[1, 2, 1]).brand_id == [1, 2]


@pytest.mark.parametrize("values", [
    {"stock": -1, "expected_version": 0},
    {"stock": 100001, "expected_version": 0},
    {"stock": 4},
    {"stock": 4, "expected_version": -1},
])
def test_invalid_stock_updates_are_rejected(values):
    with pytest.raises(ValidationError):
        StockUpdate(**values)


def test_product_money_and_sku_validation():
    base = dict(sku="FM-TEST", name="Test product", category_id=3, brand_id=1, price="49.99", stock=10)
    assert ProductCreate(**base).price == Decimal("49.99")
    for changes in [{"price": "1.001"}, {"sku": "bad sku"}, {"name": "  "}, {"stock": -1}]:
        with pytest.raises(ValidationError):
            ProductCreate(**(base | changes))


@pytest.mark.parametrize("values", [
    {"expected_version": 0}, {"expected_version": 0, "name": None},
    {"expected_version": 0, "stock": 5},
])
def test_patch_is_explicit_and_cannot_bypass_stock_audit(values):
    with pytest.raises(ValidationError):
        ProductPatch(**values)


@pytest.mark.parametrize("value", ["-1", "abc", "1\n", "１２", "9" * 19])
def test_invalid_sse_cursor(value):
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        parse_event_id(value)


def test_sse_format_and_cursor():
    assert parse_event_id(None) is None
    assert parse_event_id("12") == 12
    message = format_event(12, "stock", {"stock": 8})
    assert message == 'id: 12\nevent: stock\ndata: {"stock":8}\n\n'


def test_seed_is_deterministic_and_has_three_real_levels():
    categories, brands, products = sample_records()
    assert sample_records() == (categories, brands, products)
    assert len(products) == 600 and len(categories) == 39 and len(brands) == 8
    assert len({product[0] for product in products}) == 600
    by_id = {item[0]: item for item in categories}
    for category_id, name, parent_id, depth in categories:
        assert depth in {1, 2, 3}
        assert (parent_id is None) == (depth == 1)
        if parent_id:
            assert by_id[parent_id][3] == depth - 1
    assert all(by_id[product[3]][3] == 3 for product in products)
