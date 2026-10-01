# Build status

The rebuilt application is published on GitHub main and is live at [https://flashmarket-tejashr0716.onrender.com](https://flashmarket-tejashr0716.onrender.com). The deployed Docker service uses real MySQL 8.4.8, not browser storage or SQLite.

## Verified results

- **67 Python tests passed:** 43 unit tests and 24 integration tests against real MySQL 8.4.11; no failures or skipped tests.
- **16 browser checks passed:** filtering, recursive categories, 300 ms search debounce, 20-item client-side pagination, protected create/edit/archive, stock conflicts, two-session live updates, mobile layout, dark theme, and API documentation.
- **600 synthetic products** across three category levels; all products and brands are fictional and clearly labelled.
- Stock survived an application restart; bootstrap did not reseed the database.
- **1,500 measured HTTP requests**, ten concurrent requests, zero HTTP errors. The combined price/stock/brand/rating query had p95 **68.51 ms** and maximum **96.02 ms** across 300 requests.
- Across all five scenarios, the slowest scenario p95 was **311.75 ms**. One full-catalog request took **402.06 ms**: do not claim every request was below 400 ms.

Measurements are local, on synthetic data, and do not establish public-host latency, a production SLA, or historical performance during the dates shown on a resume. See `docs/VERIFICATION.md` and `reports/` for method and raw evidence.

## Published source and live deployment

- The replacement was squash-merged into `main` through [PR #1](https://github.com/tejashr0716/flashmarket/pull/1), commit `c29cfd348ef5fb9988603550ad47bb5082b749bf`. No force-push was used.
- The original is preserved on `legacy/frontend-prototype-2026-09-30`, commit `4d386896f4e5cec455ff2842f1672caa56d01bfd`.
- Initial source publication was independently verified: all 51 core files were present, no obsolete frontend files remained, and GitHub CI passed. Final delivery also includes live-check reports and screenshots.
- The live service uses **Render Free** in Singapore plus **Aiven Free MySQL**. The Free compute plan and “No card on file” were verified during creation. No paid upgrades or unrelated service changes were made.
- **15 live API checks and 15 live browser checks passed**, including filtering, real MySQL/TLS, protected writes, stale-version rejection, genuine two-tab SSE updates, 20-item client pagination, debounced search, and interactive Swagger.
- Sample product 600 was returned to its original stock of **51** after the reversible test; its version advanced from **0 to 2**.
- The public four-facet verification request took **716.20 ms** in one sample. It is not an SLA and does not replace the recorded local benchmark.
- Deployment and safe backup instructions are in `docs/DEPLOYMENT.md`.

## Validation limits

- A local Docker daemon was unavailable; however, Render successfully built and ran the repository’s Docker image and the live checks passed.
- Live desktop and mobile screens were reviewed. Automated interactions passed; this is not a complete manual visual audit of every modal.
- Fourteen defined text/background contrast pairs passed; this is not a complete accessibility audit.
- One Starlette/httpx compatibility deprecation warning remains; it did not fail tests.

The archive excludes real credentials, environment files, dependencies, build caches, and database binaries. Configure your own untracked `.env` using `python -m scripts.configure` before running.
