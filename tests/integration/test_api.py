import pytest
from uuid import uuid4


pytestmark = pytest.mark.integration


def test_health_is_real_mysql(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["database"] == "mysql"
    assert body["mysql_version"].startswith(("8.0", "8.4"))


def test_catalog_has_600_seeded_products(client):
    body = client.get("/api/products?limit=1000").json()
    assert body["total"] == 600 and len(body["items"]) == 600
    assert all(item["is_sample"] for item in body["items"])


def test_schema_categories_have_exactly_three_levels(client):
    categories = client.get("/api/categories").json()
    assert len(categories) == 39
    assert {category["depth"] for category in categories} == {1, 2, 3}
    assert any(category["path"] == "Electronics / Computers / Laptops" for category in categories)


def test_recursive_root_filter_matches_all_descendants(client):
    categories = client.get("/api/categories").json()
    root = next(item for item in categories if item["name"] == "Electronics")
    descendant_ids = {item["id"] for item in categories if item["path"].startswith("Electronics /")}
    body = client.get(f"/api/products?category_id={root['id']}&limit=1000").json()
    all_items = client.get("/api/products?limit=1000").json()["items"]
    expected = {item["id"] for item in all_items if item["category_id"] in descendant_ids}
    assert {item["id"] for item in body["items"]} == expected
    assert body["total"] == len(expected) > 0


def test_combined_four_facet_filter(client):
    body = client.get(
        "/api/products?min_price=1000&max_price=80000&stock=in&brand_id=1&brand_id=2&min_rating=3.5&limit=1000"
    ).json()
    assert body["total"] > 0
    assert all(
        1000 <= item["price"] <= 80000 and item["stock"] > 0
        and item["brand_id"] in {1, 2} and item["rating"] >= 3.5
        for item in body["items"]
    )


@pytest.mark.parametrize("stock", ["in", "low", "out"])
def test_stock_filter_boundaries(client, stock):
    body = client.get(f"/api/products?stock={stock}&limit=1000").json()
    assert body["total"] > 0
    predicate = {"in": lambda x: x > 0, "low": lambda x: 1 <= x <= 5, "out": lambda x: x == 0}[stock]
    assert all(predicate(item["stock"]) for item in body["items"])


def test_backend_offsets_are_distinct(client):
    first = client.get("/api/products?limit=20&offset=0").json()
    second = client.get("/api/products?limit=20&offset=20").json()
    assert first["total"] == second["total"] == 600
    assert {item["id"] for item in first["items"]}.isdisjoint(item["id"] for item in second["items"])


def test_literal_search_is_injection_safe(client):
    for search in ["' OR 1=1 --", "%", "_"]:
        body = client.get("/api/products", params={"search": search}).json()
        assert body["total"] == 0
    assert client.get("/api/stats").json()["total_products"] == 600


@pytest.mark.parametrize("query", [
    "min_price=100&max_price=50", "min_rating=8", "limit=1001", "stock=invalid",
    "sort=price%3BDROP", "brand_id=-1", "min_price=1.001",
])
def test_invalid_queries_return_422(client, query):
    assert client.get("/api/products?" + query).status_code == 422


def test_writes_require_the_key(client):
    response = client.patch("/api/products/1/stock", json={"stock": 1, "expected_version": 0})
    assert response.status_code == 401
    assert client.get("/api/admin/status", headers={"X-Admin-Key": "wrong"}).status_code == 401


def test_negative_stock_is_rejected(client, admin_headers):
    assert client.patch(
        "/api/products/1/stock", headers=admin_headers, json={"stock": -1, "expected_version": 0}
    ).status_code == 422


def test_stock_change_is_atomic_and_stale_version_is_rejected(client, admin_headers):
    repo = client.app.state.repository
    cursor_before = repo.event_cursor()
    original = client.get("/api/products/1").json()
    response = client.patch("/api/products/1/stock", headers=admin_headers, json={
        "stock": original["stock"] + 1, "expected_version": original["version"], "reason": "Integration test"
    })
    assert response.status_code == 200
    updated = response.json()
    assert updated["stock"] == original["stock"] + 1 and updated["version"] == original["version"] + 1
    stale = client.patch("/api/products/1/stock", headers=admin_headers, json={
        "stock": 2, "expected_version": original["version"],
    })
    assert stale.status_code == 409
    matching = [event for event in repo.events_after(cursor_before) if event["event_type"] == "stock" and event["payload"]["product_id"] == 1]
    assert matching[-1]["payload"]["stock"] == updated["stock"]
    restore = client.patch("/api/products/1/stock", headers=admin_headers, json={
        "stock": original["stock"], "expected_version": updated["version"], "reason": "Restore test fixture"
    })
    assert restore.status_code == 200


def test_create_edit_archive_lifecycle(client, admin_headers):
    payload = {
        "sku": f"TEST-{uuid4().hex[:16].upper()}", "name": "Lifecycle test product", "brand_id": 1,
        "category_id": 3, "price": "1234.56", "stock": 9, "rating": "4.2",
        "description": "<script>alert('test')</script>",
    }
    created = client.post("/api/products", headers=admin_headers, json=payload)
    assert created.status_code == 201
    product = created.json()
    assert not product["is_sample"]
    assert client.post("/api/products", headers=admin_headers, json=payload).status_code == 409
    edited = client.patch(f"/api/products/{product['id']}", headers=admin_headers, json={
        "name": "Lifecycle product updated", "price": "2345.67", "expected_version": product["version"],
    })
    assert edited.status_code == 200 and edited.json()["price"] == 2345.67
    response = client.delete(
        f"/api/products/{product['id']}?expected_version={edited.json()['version']}", headers=admin_headers
    )
    assert response.status_code == 204
    assert client.get(f"/api/products/{product['id']}").status_code == 404
    assert client.get("/api/stats").json()["total_products"] == 600


def test_references_must_exist_and_categories_must_be_leaf(client, admin_headers):
    base = dict(sku="TEST-INVALID", name="Reference test", brand_id=1, category_id=1, price="1.00", stock=0)
    assert client.post("/api/products", headers=admin_headers, json=base).status_code == 422
    assert client.post("/api/products", headers=admin_headers, json=base | {"category_id": 99999}).status_code == 422
    assert client.post("/api/products", headers=admin_headers, json=base | {"category_id": 3, "brand_id": 99999}).status_code == 422


def test_ui_and_security_headers(client):
    response = client.get("/")
    assert response.status_code == 200 and "Your inventory." in response.text
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").json()["info"]["version"] == "1.0.0"


def test_stats_cross_foot_against_actual_products(client):
    products = client.get("/api/products?limit=1000").json()["items"]
    stats = client.get("/api/stats").json()
    assert stats["total_products"] == len(products)
    assert stats["in_stock"] + stats["out_of_stock"] == len(products)
    assert stats["low_stock"] == sum(1 <= item["stock"] <= 5 for item in products)
    assert stats["total_units"] == sum(item["stock"] for item in products)
    assert abs(stats["inventory_value"] - sum(item["price"] * item["stock"] for item in products)) < 0.01
