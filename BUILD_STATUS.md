# Build status

The rebuilt application and downloadable source are complete. This is a tested local build, not a published website.

## Verified results

- **67 Python tests passed:** 43 unit tests and 24 integration tests against real MySQL 8.4.11; no failures or skipped tests.
- **16 browser checks passed:** filtering, recursive categories, 300 ms search debounce, 20-item client-side pagination, protected create/edit/archive, stock conflicts, two-session live updates, mobile layout, dark theme, and API documentation.
- **600 synthetic products** across three category levels; all products and brands are fictional and clearly labelled.
- Stock survived an application restart; bootstrap did not reseed the database.
- **1,500 measured HTTP requests**, ten concurrent requests, zero HTTP errors. The combined price/stock/brand/rating query had p95 **68.51 ms** and maximum **96.02 ms** across 300 requests.
- Across all five scenarios, the slowest scenario p95 was **311.75 ms**. One full-catalog request took **402.06 ms**: do not claim every request was below 400 ms.

Measurements are local, on synthetic data, and do not establish public-host latency, a production SLA, or historical performance during the dates shown on a resume. See `docs/VERIFICATION.md` and `reports/` for method and raw evidence.

## Publication and remaining authorization

- The original is backed up on `legacy/frontend-prototype-2026-09-30`. The replacement branch is in progress; bulk MCP upload was blocked, and website publication is authorized.
- No public deployment has been created. The free-tier hosting route is authorized; account setup and public deployment are still in progress.
- Use this ZIP for the rebuilt implementation until GitHub is updated. Deployment and safe backup instructions are in `docs/DEPLOYMENT.md`.

## Validation limits

- Docker configuration is provided, but no Docker daemon was available, so a Docker build/deployment was not validated here.
- Desktop/mobile previews were visually reviewed in the initial build. Final modal screenshots were generated, but final manual screenshot inspection was unavailable after the environment refreshed. The automated interaction checks passed.
- Fourteen defined text/background contrast pairs passed; this is not a complete accessibility audit.
- One Starlette/httpx compatibility deprecation warning remains; it did not fail tests.

The archive excludes real credentials, environment files, dependencies, build caches, and database binaries. Configure your own untracked `.env` using `python -m scripts.configure` before running.
