import os
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database
from app.main import create_app
from scripts.seed import seed_catalog
from scripts.setup import apply_schema


@pytest.fixture(scope="session")
def client():
    if os.getenv("RUN_MYSQL_TESTS") != "1":
        pytest.skip("Set RUN_MYSQL_TESTS=1 and TEST_DB_NAME to a disposable MySQL database")
    name = os.getenv("TEST_DB_NAME", "flashmarket_test")
    if not name.endswith(("_test", "_tests")):
        raise RuntimeError("Refusing integration tests against a database without a _test suffix")
    settings = replace(
        Settings.from_env(), db_name=name,
        admin_api_key="test-only-admin-key-never-use-in-production-12345",
    )
    database = Database(settings)
    try:
        apply_schema(database)
        seed_catalog(database)
    finally:
        database.close()
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def admin_headers():
    return {"X-Admin-Key": "test-only-admin-key-never-use-in-production-12345"}
