# FlashMarket Browser Performance Benchmark Report

- **Generated**: 2026-10-22T16:28:14.087Z
- **Runs per condition**: 30 measured iterations (+ 3 warmups)
- **Viewport**: 1440 x 900 (Light theme)
- **Page Readiness Metric**: Navigation / filter action until `#catalog[aria-busy="false"]` with 20 items rendered in `#products-body`.

## Benchmark Results

| Metric | Baseline (`app.baseline.js`) | Optimized (`app.js`) | Improvement (Δ %) |
|---|---|---|---|
| **Cold Catalog Ready (Median)** | 82.54 ms | **80.64 ms** | **+2.3%** |
| **Cold Catalog Ready (p95)** | 112.98 ms | **101.85 ms** | — |
| **Warm Category Revisit (Median)** | 99.89 ms | **73.87 ms** | **+26%** (faster) |
| **Warm Category Revisit (p95)** | 100.48 ms | **74.64 ms** | — |
| **Warm Transferred API Bytes** | 239.8 KB | **159.1 KB** | **+33.7%** (saved) |
| **Warm API Requests** | 3 reqs | **2 reqs** | — |
| **JavaScript / Console Errors** | 0 | **0** | Zero errors |

## Engineering Optimizations

1. **Client-Side Safe Response Caching with Invalidation**:
   - Implemented an in-memory `ClientResponseCache` with configurable TTL and request deduplication.
   - Re-filtering or navigating back to previously viewed categories serves data instantly from memory without redundant network roundtrips, reducing transferred bytes during warm navigation by **33.7%**.
   - Verified that admin stock adjustments and SSE events strictly invalidate the cache, preventing stale inventory views.

2. **DOM Event Delegation & Reduced Closure Allocations**:
   - Replaced per-row `addEventListener` registrations on 20 product links and stock action buttons with a centralized delegated listener on `#products-body`.
   - Eliminates 40+ listener bindings and closure allocations on every table render or page change.

3. **Distinction from Historical Claims**:
   - Historical internship bullet claims ("40% page load reduction") were unverified due to lack of historical baseline code.
   - This benchmark establishes a reproducible local baseline and measures a **26% speedup** on warm view revisits and **33.7% reduction** in transferred API payload bytes on modern browser workloads.
