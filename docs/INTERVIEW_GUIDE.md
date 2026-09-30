# Interview guide — explain the implementation, not a script

Use this guide to understand the actual code. Do not memorize answers you cannot demonstrate. Sample products and measured local performance are not real customers or production traffic.

## A short project explanation

“Flash Market is a catalog and inventory API built with FastAPI and MySQL. It stores 600 synthetic products in a three-level category tree. I wrote an explicit parameterized query builder to combine price, stock, brand, and rating filters, and used a recursive CTE to include category descendants. A vanilla JavaScript UI debounces search by 300 ms and paginates results at 20 products per page. Stock writes use transactions and version checks; SSE delivers change events to other sessions.”

Adapt this only after you have run and understood each part. Do not present assistance, dates, performance targets, or sample data as something they are not.

## A five-minute demonstration

1. Open `/health` and show the real MySQL server version.
2. Open `/docs`: inspect the product query parameters and request schemas.
3. Open the UI: show the database-derived product count and Sample catalog label.
4. Select **Electronics**, then **Electronics / Computers / Laptops**. Explain why the root includes many leaves and the leaf does not.
5. Combine price range, availability, brand, and minimum rating. Show the network request and returned results.
6. Type a search term quickly. Show that the request occurs after 300 ms of idle time, rather than for every keystroke.
7. Go from page 1 to page 2. Show different SKUs and no new products request.
8. Open a second tab (or a second browser session).
9. Unlock inventory in the first tab using your own deployment's admin key. Adjust a product's stock.
10. Show the second tab updating via `/api/events`. Show the matching durable event in MySQL if asked.
11. Open two stock-edit dialogs with the same version. Save one, then the other: the stale save is rejected with 409.
12. Show the benchmark command and its raw CSV. Explain the recorded environment and the difference between local latency and public hosting latency.

## Common questions

### Why FastAPI instead of Flask?

Both can implement this service. FastAPI gives typed request/response models, dependency injection, OpenAPI documentation, and an ASGI foundation for the SSE route. The choice is about this project's needs, not “Flask is slow.”

### What does Pydantic do?

It parses and validates requests before repository code runs: price precision, non-negative stock, rating 0–5, allowed sorts, maximum batch size, and expected version. `extra="forbid"` also rejects unrecognized write fields.

### Why MySQL instead of browser storage?

The project needs durable shared state, joins, constraints, indexing, transactions, and recursive SQL. Browser storage is per browser and cannot provide these database guarantees.

### Why mysql-connector-python? Why no ORM?

It provides a MySQL driver, bound parameters, and a connection pool. Explicit SQL makes recursive traversal and query construction easy to inspect. An ORM could also work; it is not inherently wrong or insecure.

### What is a connection pool?

Reusable connections avoid establishing a new connection for every request. This application checks out a connection for a short operation, commits writes or rolls back unfinished transactions, and returns it. Pool size must match concurrency and MySQL connection limits.

### Are all database operations asynchronous?

No. The connector is synchronous. Normal synchronous route functions run in FastAPI's threadpool; the async SSE generator offloads database reads with `asyncio.to_thread`. Direct blocking calls inside `async def` would block the event loop.

### How does recursive SQL work here?

The anchor selects the requested category. The recursive member selects children whose `parent_id` matches a previously found ID. The product query matches any resulting category ID. Traversal is bounded to the supported three-level taxonomy.

### How are four filters combined?

The builder adds conditions only when supplied, with `AND` between dimensions. Repeated brand IDs form a parameterized `IN` expression. The count query uses the same filtering structure as the list query.

### How do you prevent SQL injection?

Values are passed separately to the driver. Sort identifiers are selected from a fixed mapping. The tests include injection-like search strings and invalid sort values. Never claim that parameterizing values also safely parameterizes arbitrary SQL identifiers.

### Why escape LIKE wildcards?

Without escaping, typing `%` would match essentially every name. This interface treats search text literally and uses `ESCAPE '='` independently of MySQL's backslash mode.

### Which indexes help?

Category-parent traversal and active catalog queries with category/brand plus price have targeted indexes. The leftmost-prefix rule and query selectivity matter. Show the saved EXPLAIN plan; do not promise every index is selected.

### What happens when two users adjust stock?

Each request submits the version it read. A row lock serializes the transaction and a version comparison rejects the stale writer with 409. The frontend must reload before retrying; it must not automatically overwrite.

### Could stock change but the event fail to save?

They are in the same transaction. A failure rolls both back. SSE reads only committed events, so it does not publish a rolled-back stock change.

### Why SSE instead of WebSockets?

The stream is one-way server-to-browser. SSE provides a simple HTTP-based transport, native reconnect, and event IDs. Stock writes use REST. Bidirectional messaging could justify WebSockets in a different system.

### Is it truly instantaneous?

No. The current server checks the event table every second and pushes committed changes. Describe it as live/near-real-time updates with that bounded polling interval, not zero latency or a database-native push mechanism.

### Why client-side pagination?

It directly supports a small 600-product demonstration and makes page navigation immediate after fetching. Server pagination is still exposed by the API. A larger catalog should use server-side/keyset pagination and a different UI strategy.

### How did you measure “under 400 ms”?

Run the benchmark and use its actual result. It measures HTTP completion for five catalog-query scenarios, with specified concurrency, warmups, raw samples, percentiles, and database/environment metadata. Public internet, cold starts, and production loads were not measured by that local test.

### What would you improve next?

Pick one observed limitation, not a shopping list: larger-catalog pagination/search, event dispatch at scale, real multi-user authentication, migration tooling, or public-host performance measurements. Explain how you would measure whether the improvement is needed.

## SQL commands to know

```sql
SELECT COUNT(*) FROM products WHERE is_active = 1;
SELECT depth, COUNT(*) FROM categories GROUP BY depth;
SELECT sku, stock, version FROM products WHERE id = 1;
SELECT id, event_type, payload FROM inventory_events ORDER BY id DESC LIMIT 5;
SHOW INDEX FROM products;
```

Study `app/query_builder.py`, `app/repository.py`, `app/main.py`, and `app/static/app.js` in that order. They are the most useful files to walk through on screen.

## Resume truth checklist

- Product count means seeded database records, not real users or sales.
- Category depth is demonstrated by the seeded parent-child relationships.
- Latency claims must state the measurement conditions and be updated if deployment results differ.
- This rebuild does not prove that these features existed during an earlier date range.
- Claim only libraries and mechanisms you have learned well enough to explain.
