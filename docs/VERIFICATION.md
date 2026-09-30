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

The source is ready, but it has **not been pushed or publicly deployed**. The original is backed up, and the replacement branch is in progress. Website publication and free-tier hosting are authorized; neither the replacement on main nor public deployment is complete.

The Docker configuration has not been built or run here because a Docker daemon was unavailable. Desktop/mobile previews were reviewed during the initial build. Final modal screenshots were generated, but their manual inspection was unavailable after the environment refreshed. Browser interaction checks passed; do not interpret that as a full manual visual or accessibility audit.

Current measurements do not verify the original May–October 2025 dates or historical metrics. Use only dates and contributions you can truthfully explain. The fictional seed catalog is demonstration data, not customer usage.
