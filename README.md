# Flash Market — Catalog & Inventory API

A real **Python / FastAPI / MySQL** project with a framework-free **HTML5, CSS3, and JavaScript** interface. Products live in MySQL, not browser storage. All displayed counts come from database queries.

This is an interview-sized portfolio project, not a production commerce platform. Its **600 products, eight brands, prices, and ratings are synthetic sample data**, clearly labelled in the UI. Example prices are in INR.

## What you can demonstrate

| Feature | Implementation / evidence |
|---|---|
| 500+ products | Deterministic seed of 600 real database rows, `scripts/seed.py` |
| Three category levels | 39 categories: 3 roots, 9 intermediate categories, 27 leaves |
| Recursive category queries | `WITH RECURSIVE` in `app/query_builder.py`; a root filter includes descendants |
| Price, stock, brand, rating filters | Parameterized SQL builder; all supplied filters combine with `AND` |
| Safe queries | Bound values, allowlisted sorting, literal LIKE wildcard escaping |
| 300 ms search debounce | `app/static/app.js`; old requests are cancelled with `AbortController` |
| 20 products per page | Genuine client-side slicing using the current page offset |
| Live stock updates | SSE transport, durable MySQL event log, automatic cross-session refresh |
| Inventory operations | Protected create, edit, stock-adjustment, and soft-archive endpoints |
| Data consistency | Transactions, row locks, expected-version checks, foreign keys, CHECK constraints |
| Performance | Runnable benchmark, raw measurements, real optimizer plan; see `reports/` |

**Latency is measured, not guaranteed.** Local benchmark results do not imply the same response time on a free hosting tier or across the internet. See [verification](docs/VERIFICATION.md) and the recorded [benchmark evidence](reports/benchmark_summary.json).

## Quick start: Docker

The original React/browser-storage prototype is preserved on `legacy/frontend-prototype-2026-09-30`. This replacement uses FastAPI and real MySQL. Node is optional and used only for browser tests.

You need Git, Python 3.10+ (only for generating `.env`), and Docker with Compose.

```bash
git clone https://github.com/tejashr0716/flashmarket.git
cd flashmarket
python -m scripts.configure
docker compose up --build
```

Open:

- Application: `http://localhost:8000`
- Interactive REST documentation: `http://localhost:8000/docs`
- Database health: `http://localhost:8000/health`

The first start creates schema v1 and seeds the catalog. Subsequent starts **do not overwrite stock changes or user-created products**. MySQL persists in the `mysql-data` volume and is not exposed on a host port.

To adjust inventory, read `ADMIN_API_KEY` from **your own local `.env`** and enter it in **Unlock inventory**. Never commit or send this key in chat. Reloading the tab clears it from memory.

```bash
docker compose down
```

This stops containers without deleting the database. **Do not use `down -v` unless you intentionally want to delete your local database.**

## Native Python + MySQL

Requires Python 3.10+ and MySQL 8.0.16+ or 8.4. No Node, npm, React, TypeScript, Gemini API, Redis, or cloud account is needed for local operation.

```bash
python -m venv .venv
```

Activate the environment:

```bash
# macOS / Linux
source .venv/bin/activate
```

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

Then:

```bash
pip install -r requirements-dev.txt
python -m scripts.configure
```

Create the database and account in MySQL using passwords of your own:

```sql
CREATE DATABASE flashmarket CHARACTER SET utf8mb4;
CREATE USER 'flashmarket'@'localhost' IDENTIFIED BY 'YOUR_DATABASE_PASSWORD';
GRANT ALL PRIVILEGES ON flashmarket.* TO 'flashmarket'@'localhost';
```

Edit `.env` so `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` match that account. Keep the generated admin key private. Then:

```bash
python -m scripts.setup --seed
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`setup` is an additive schema bootstrap, not a general migration framework. It never drops tables. Seeding refuses to overwrite an existing unmarked catalog.

## Tests and measurements

```bash
# Unit tests; integration tests are explicitly skipped without MySQL test configuration.
pytest -q tests/unit
```

For integration tests, create a **separate** database, grant the test account access, and follow [verification instructions](docs/VERIFICATION.md). The test database name must end in `_test` or `_tests`.

With the application running:

```bash
python -m scripts.benchmark --url http://127.0.0.1:8000 --samples 300 --concurrency 10
python -m scripts.explain
```

These commands write `reports/benchmark_raw.csv`, `reports/benchmark_summary.json`, and `reports/explain.json`. Benchmark raw data is retained, including slow requests and errors.

## REST endpoints

| Method | Route | Access |
|---|---|---|
| GET | `/health` | Public; verifies a real MySQL connection |
| GET | `/api/products` | Public; filters, allowlisted sorting, bounded limit/offset |
| GET | `/api/products/{id}` | Public |
| GET | `/api/categories`, `/api/brands`, `/api/stats` | Public |
| GET | `/api/events` | Public SSE stream with reconnection cursor |
| GET | `/api/admin/status` | `X-Admin-Key` |
| POST | `/api/products` | `X-Admin-Key` |
| PATCH | `/api/products/{id}` | `X-Admin-Key`, `expected_version` |
| PATCH | `/api/products/{id}/stock` | `X-Admin-Key`, `expected_version`, reason |
| DELETE | `/api/products/{id}?expected_version=N` | `X-Admin-Key`; soft archive |

Example:

```text
/api/products?category_id=1&min_price=1000&max_price=80000&stock=in&brand_id=1&brand_id=2&min_rating=3.5&sort=price_asc&limit=100
```

Repeated `brand_id` values select any of those brands. `stock=in` means **greater than zero**, including low stock; `stock=low` means 1–5; `stock=out` means zero.

## Why these libraries?

| Library | Job / reason |
|---|---|
| FastAPI | REST routing, dependency injection, validated input/output, generated OpenAPI docs |
| Pydantic | Typed request models, range checks, unknown-field rejection |
| mysql-connector-python | MySQL connection pool and bound SQL parameters; explicit SQL keeps the CTE/query builder visible |
| Uvicorn | ASGI server; serves FastAPI and long-lived SSE connections |
| python-dotenv | Local configuration; hosting environment variables take precedence |
| pytest | Unit and real-database integration tests |
| httpx | HTTP integration client and repeatable latency measurement |

The synchronous MySQL driver runs inside FastAPI's threadpool. SSE database reads use `asyncio.to_thread` so they do not block the event loop. Using `async def` alone would not make a blocking database call asynchronous.

## Explore / interview / deploy

- [Architecture and trade-offs](docs/ARCHITECTURE.md)
- [Interview guide and demonstration](docs/INTERVIEW_GUIDE.md)
- [Verification and reproducible measurements](docs/VERIFICATION.md)
- [Live deployment instructions](docs/DEPLOYMENT.md)

Before replacing the original repository, preserve the earlier React/browser-storage prototype on a backup branch such as `legacy/frontend-prototype`. This rebuild does not establish or backdate a historical development period.
