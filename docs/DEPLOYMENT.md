# Live deployment

The code is deployable, but a GitHub repository alone is **not** a live FastAPI/MySQL service. Hosting needs a Python/container service, a persistent MySQL database, and account access. Do not put database URLs or admin keys in source control.

## Free-tier route: Render + Aiven MySQL

Use **Render Free** for the application and **Aiven Free MySQL** for persistent data. Choose the free plan explicitly, not a credit-limited database trial. These are demo tiers with sleep and usage limits, not production availability guarantees.

1. Create a free Aiven MySQL service in your own account, without adding payment details. MySQL must be at least version 8.0.16.
2. Create a dedicated application database/user where supported. Set private service variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and a new random `ADMIN_API_KEY` of at least 32 characters. Never commit these values.
3. Set `DB_SSL_CA_PEM` to the complete public CA certificate. The startup script writes a mode-0600 temporary file and sets `DB_SSL_CA`; the connector verifies the certificate and hostname. Never disable verification to resolve connectivity issues.
4. Create a Render web service using the Docker runtime, this repository, and the **free** compute plan. Choose a region near the database's available free region. Do not attach a paid disk.
5. Verify billing limits before deployment: free services may incur bandwidth/build overages when a payment method is attached. Use available hard spending controls; if zero charges cannot be verified, stop rather than assume. Do not change billing for unrelated projects without approval. Existing Render free services share the workspace's instance-hour allowance.
6. Validate the live application with the checklist below. Before an interview, open the site and verify the database is awake. Do not generate artificial traffic to evade free-tier sleep limits.

Current official limits: [Render Free](https://render.com/docs/free), [Aiven Free MySQL](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier). Aiven can pause inactive databases; Render can sleep idle apps and suspend services that exceed quotas. Public-host latency must be measured separately from the localhost benchmark.

## Railway: application + MySQL

The included `Dockerfile` and `railway.toml` support this route. Confirm Railway's current plan and charges in your account before creating resources; this guide does not promise free hosting.

1. Create a Railway project in **your own account**.
2. Add a MySQL service. Keep its storage persistent.
3. Add an application service connected to `tejashr0716/flashmarket`, branch `main`.
4. In application variables, set `DATABASE_URL` using Railway's variable reference to the MySQL service's connection URL. Prefer its private-network endpoint.
5. Set a new `ADMIN_API_KEY` with at least 32 random characters. Do not reuse CI/test credentials or commit it.
6. Railway supplies `PORT`; `start.sh` binds to that value on `0.0.0.0`.
7. Deploy. Startup applies the additive schema and seeds only a new, unmarked catalog.
8. Generate a public HTTPS domain for the application service.
9. Verify `/health`, `/docs`, the UI, filtering, and two-tab stock updates.
10. Keep the admin key private; public visitors should have read-only access.

If a managed MySQL provider requires certificate validation, mount its CA certificate and set `DB_SSL_CA`. The connector then verifies the certificate and hostname. Do not disable a provider's TLS requirements to make setup easier.

## Other providers

- **Render or another container/Python host:** connect a persistent, reachable MySQL 8 database, set `DATABASE_URL` or `DB_*`, and launch `./start.sh`. Persistent MySQL must not run inside the ephemeral application container.
- **Your server:** use Docker Compose behind an HTTPS reverse proxy. Keep the MySQL volume backed up. Do not publish MySQL's port to the internet.
- **GitHub Pages / static-only hosting:** cannot run this backend or MySQL. Hosting only the HTML would not substantiate the backend resume bullets.

## Deployment validation

Before sharing the URL:

- `/health` reports real MySQL, not a mock or SQLite replacement.
- The initial active catalog contains 600 labelled sample rows.
- Selecting a parent category returns descendant products.
- All four filter dimensions work in combination.
- Page 2 shows different products, 20 per page.
- An incorrect or missing admin key cannot modify data.
- Stock changes propagate to a second connected session.
- Application restart preserves stock and user-created products.
- The application is served over HTTPS.
- Benchmark the deployed URL separately if you want public-host latency evidence.

## Rollback and backups

Before replacing the repository, create a backup branch such as `legacy/frontend-prototype` for the browser-only frontend. Do not deploy that version and call it a FastAPI/MySQL service. A code rollback is not a database backup. Before future schema changes, take a database backup and use an explicit migration plan.
