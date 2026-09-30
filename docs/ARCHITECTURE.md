# Architecture and trade-offs

## Request path

```text
HTML / CSS / vanilla JavaScript
          │ same-origin fetch
          ▼
FastAPI routes + Pydantic validation
          │ typed filters / write requests
          ▼
CatalogRepository
          │ compiled SQL + separate bound parameters
          ▼
mysql-connector-python connection pool
          │
          ▼
MySQL 8 / InnoDB
```

The browser is not the source of truth. A page refresh, second tab, or application restart reads the same persistent database.

## Data model

- `brands`: unique brand names.
- `categories`: adjacency list (`parent_id`) with depth 1–3.
- `products`: SKU, leaf category, brand, decimal price/rating, stock, version, active/sample flags.
- `inventory_events`: append-only change records and SSE replay source.
- `app_metadata`: records successful one-time seed application.

The category taxonomy is seeded and read-only through this API. The seed verifies parent-first insertion and three real levels. The `depth` CHECK alone does not establish that a parent has the correct depth; the seed and tests provide that invariant. Manual SQL edits must preserve it. Category-editing endpoints and general cycle detection are deliberately out of scope.

Prices use `DECIMAL(10,2)` in MySQL and `Decimal` in write models. JSON output presents numeric values for the interface. This project has no payment, tax, or financial-ledger implementation.

## Recursive filtering

```sql
WITH RECURSIVE category_tree AS (
    SELECT id, 1 AS traversal_depth
    FROM categories WHERE id = %s
    UNION ALL
    SELECT c.id, t.traversal_depth + 1
    FROM categories c
    JOIN category_tree t ON c.parent_id = t.id
    WHERE t.traversal_depth < 3
)
SELECT ...
FROM products p
WHERE p.category_id IN (SELECT id FROM category_tree);
```

Selecting Electronics returns products under Computers, Audio, and Mobile and their leaves. It does not perform one query for each tree node. The depth guard matches this project's three-level taxonomy.

## Dynamic SQL safety

1. Pydantic rejects invalid ranges, unknown stock/sort choices, and oversized requests.
2. The builder combines **trusted SQL fragments** according to supplied filters.
3. All user values remain separate `%s` parameters.
4. Sort expressions come from a closed mapping, never raw client input.
5. Search escapes `%`, `_`, and the chosen LIKE escape character `=`.
6. List and count share the same CTE/WHERE parameters and repeatable-read snapshot.

It would be misleading to say there is “no SQL string construction.” There is controlled construction of SQL structure, but **no interpolation of user values**.

## Index choices

- `(parent_id)` supports child traversal.
- `(is_active, price, id)` supports active-catalog price queries.
- `(is_active, category_id, price, id)` targets category + price workloads.
- `(is_active, brand_id, price, id)` targets brand + price workloads.
- `(product_id, created_at)` supports looking up a product's change history.
- The event primary key supports ordered reads after the last event ID.

Indexes cost disk space and extra work on writes. A small 600-row table may legitimately use a table scan. The optimizer can choose a different plan for different filters; adding an index does not guarantee its use or remove every filesort. Use `scripts.explain` to examine the **actual** plan rather than claiming an unmeasured before/after improvement.

Leading-wildcard search (`%term%`) is intentional for this small catalog and is not a scalable indexed text-search solution. A larger system could use FULLTEXT or a dedicated search service after measuring the need.

## Inventory consistency

A stock write:

1. Authenticates the admin key.
2. Starts a database transaction.
3. Locks the active product with `SELECT ... FOR UPDATE`.
4. Compares the submitted version with the current version.
5. Updates stock and increments version.
6. Inserts the event in the **same transaction**.
7. Commits both changes.

A stale editor receives HTTP 409 rather than silently overwriting a newer change. Invalid stock is rejected by both request validation and MySQL constraints. Product archival is soft: the record and its event history remain.

## Live updates: exact mechanism

The server exposes SSE and the browser uses native `EventSource`. Each connected stream checks the durable MySQL event log **once per second**, then pushes new events. The browser does not repeatedly poll the products endpoint on a timer; it refetches matching results when an event arrives.

This is near-real-time, not zero-latency delivery. SSE is suitable because updates travel from server to browser; writes still use ordinary HTTP. It has native reconnect support and `Last-Event-ID` replay. A periodic heartbeat helps keep connections open.

The one-second database polling is a deliberate small-system trade-off: no Redis/broker dependency, persistence across app restarts, and compatibility across app instances. For thousands of connected clients, replace per-stream database polling with a shared event-dispatch mechanism and define retention/replay rules. The configured connection cap limits this demo's SSE resource use.

## Pagination

The interface retrieves matching products, then displays:

```javascript
const start = (currentPage - 1) * 20;
const rows = results.slice(start, start + 20);
```

Page changes themselves make no products request. Backend limit/offset remains available for API consumers and bounded batches. This client-side approach suits the 600-row demonstration, not a million-product catalog. The UI refuses views above 10,000 matching results instead of silently dropping records.

## Security and limits

- Read routes are public; writes require a random admin key of at least 32 characters.
- Admin comparison uses `secrets.compare_digest`.
- The browser holds the key only in memory; there is no localStorage persistence.
- API text renders with DOM `textContent`, not HTML injection.
- The application and API share an origin; no permissive CORS is needed.
- Production hosting must provide HTTPS. A long-lived shared key is not a full multi-user authentication system.
- Swagger uses externally hosted assets and is exempt from the UI's strict CSP.
- Logs do not print credentials or detailed SQL errors.

Not included: payments, orders, customer accounts, image uploads, multi-warehouse allocation, background fulfilment, comprehensive migrations, or a production-grade identity/rate-limiting system.
