# Verification and repeatable measurements

## Unit tests

```bash
pip install -r requirements-dev.txt
pytest -q tests/unit
```

Coverage includes SQL structure/parameters, injection-like searches, literal wildcard escaping, sort allowlisting, bounds, stock validation, sparse edit validation, SSE formatting/cursors, and seed invariants.

## Integration tests: real MySQL only

Create a disposable database:

```sql
CREATE DATABASE flashmarket_test CHARACTER SET utf8mb4;
GRANT ALL PRIVILEGES ON flashmarket_test.* TO 'flashmarket'@'localhost';
```

The test fixture uses your `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_PASSWORD`, but overrides the database name to `TEST_DB_NAME`. It refuses names without a `_test` or `_tests` suffix. Never point the tests at a production database.

```bash
# macOS / Linux
RUN_MYSQL_TESTS=1 TEST_DB_NAME=flashmarket_test pytest -q
```

```powershell
# Windows PowerShell
$env:RUN_MYSQL_TESTS = "1"
$env:TEST_DB_NAME = "flashmarket_test"
pytest -q
```

These test real SQL execution, recursive descendants, combined filters, stock boundaries, pagination offsets, parameter safety, validation, write authorization, transactions/version conflicts, event persistence, create/edit/archive, referential validation, and totals against actual rows.

The disposable test database accumulates archived lifecycle-test rows and audit events. Start from a newly created disposable database when exact repeatability is needed. The fixture never drops an existing database automatically.

## Browser checks

`tests/browser/smoke.mjs` is an optional developer smoke test using Playwright and a local Chromium installation. Node is a test-only tool, not required to run the application.

```bash
npm install
BASE_URL=http://127.0.0.1:8000 npm run test:browser
```

For protected write checks, supply `ADMIN_API_KEY` as an environment variable. Do not paste it into a tracked test file. See the script's output for which checks ran.

## Benchmark method

Start a real MySQL-backed application, then:

```bash
python -m scripts.benchmark --samples 300 --concurrency 10 --warmup 20
python -m scripts.explain
```

Five scenarios cover:

1. Reading the full 600-product sample catalog.
2. Combining the four requested filter dimensions.
3. Recursive root-category filtering.
4. Literal keyword search.
5. Low-stock filtering and sorting.

Each scenario has 20 warmups and 300 measured HTTP requests, with up to ten concurrent requests. Measurements include reading the full HTTP response body; HTTP errors remain in the raw data and cause the command to fail.

Percentiles use the nearest-rank definition. This is a local test of a small synthetic catalog, not an internet test, throughput study, production SLA, or evidence of historical performance.

Artifacts:

- `reports/benchmark_raw.csv`: every measured request.
- `reports/benchmark_summary.json`: scenario metrics, environment, database version, and caveat.
- `reports/explain.json`: actual MySQL optimizer plan, not a hand-written estimate.
- `reports/verification.json`: checks performed during this rebuild.

The recorded results below are generated only after the tests and benchmark have run successfully.

## Recorded rebuild results

Measured on 2026-09-30T15:24:38.942263+00:00 using Python 3.13.14 and MySQL 8.4.11. The application and benchmark client ran on localhost; warmups were excluded.

- Python: **67 passed** (43 unit, 24 real-MySQL integration), zero failed/skipped.
- Browser: **16 passed**; details in `reports/browser_checks.json`.
- Restart/bootstrap persistence: passed; details in `reports/persistence.json`.
- Defined contrast pairs: **14 passed**, not a full accessibility audit.
- Measured HTTP requests: **1,500**, zero errors, concurrency **10**, active sample catalog **600**.

| Scenario | Requests | p50 (ms) | p95 (ms) | Maximum (ms) |
| --- | ---: | ---: | ---: | ---: |
| Full catalog | 300 | 199.31 | 311.75 | 402.06 |
| Price + stock + brand + rating | 300 | 49.54 | 68.51 | 96.02 |
| Recursive root category | 300 | 71.25 | 111.12 | 157.56 |
| Literal keyword search | 300 | 56.76 | 80.06 | 97.73 |
| Low-stock filtering and sorting | 300 | 46.76 | 66.92 | 138.07 |

All 300 four-facet requests were below 400 ms in this run, with p95 68.51 ms. That supports a **scoped local measurement**, not an unconditional latency promise. Across the five scenarios, 1 full-catalog request reached 402.06 ms. Do not say all requests stayed below 400 ms.

The raw CSV was independently recomputed and checked against the summary: 1,500 request-grain rows, no duplicate scenario/sample keys, no missing required values, all HTTP 200 responses, and no negative latencies. `reports/data_profile.json` documents that the bundled profiler was unavailable after the environment refreshed; direct CSV validation was used instead.

### Delivery and visual-review limits

The replacement source is **published on GitHub main** through PR #1, commit `c29cfd348ef5fb9988603550ad47bb5082b749bf`, with all 51 expected files and zero obsolete frontend files. GitHub CI passed. The original remains preserved on `legacy/frontend-prototype-2026-09-30`; no force-push was used. The public service is now **live** at [https://flashmarket-tejashr0716.onrender.com](https://flashmarket-tejashr0716.onrender.com), using Render Free and Aiven Free MySQL 8.4.8. Both certificate and hostname verification are enabled, and the application database user is scoped to the project database.

A local Docker daemon was unavailable, but Render successfully built and ran the Docker image. Live desktop/mobile screens were reviewed and the browser interactions passed. This is not a complete manual visual or accessibility audit of every modal.

Current measurements do not verify the original May–October 2025 dates or historical metrics. Use only dates and contributions you can truthfully explain. The fictional seed catalog is demonstration data, not customer usage.

## Live deployment verification

- **15 live API checks passed**: real MySQL, 600 sample rows, three-level taxonomy, recursive category filtering, all four facets, literal wildcard search, validation, protected writes, OpenAPI, source-byte match, and verified TLS/database-scoped privileges.
- **15 live browser checks passed**: desktop/mobile rendering, 20-row client pagination with no extra catalog request, debounce, recursive filtering, private inventory unlock, no key in browser storage, UI stock writes, second-tab SSE propagation, stale-write rejection, restored fixture, reload clearing the key, viewport fit, and interactive Swagger.
- The reversible test changed sample product 600 from stock 51 to 52 and back to 51. Version advanced from 0 to 2; no user-created product was used.
- One live four-facet sample took **716.20 ms**. This is neither a public-host benchmark distribution nor an SLA. Local results above remain separately scoped.
- Evidence: `reports/live_api_checks.json`, `reports/live_browser_checks.json`, `reports/deployment_verification.json`, and the live screenshots in `reports/screenshots/`.

No real credentials are included in these reports or the source archive. Free-tier sleep, quota suspension, and database inactivity remain operational limits.
