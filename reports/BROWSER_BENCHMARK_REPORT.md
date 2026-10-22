# FlashMarket Browser Performance Benchmark Report (Audited & Counterbalanced)

- **Generated**: 2026-10-22T17:32:27.916Z
- **Methodology**: Counterbalanced interleaved execution (30 measured pairs, 3 warmups), alternating condition order per pair, fresh browser contexts (1440x900).
- **Baseline SHA-256**: `5f6276651f80284764d57f67d2861549f28a57049d59b86430e1e5926ff79fe0`
- **Optimized SHA-256**: `8a4ff62fffec2f0d8d2d94f8baa948c50dbed0be8ae4ea6b251f8cfdcdd63c98`
- **Workload Phases**:
  1. `Cold Load`: Initial visit to `/` (20 items rendered, 600 total in catalog).
  2. `Sequence Transitions`: Navigation through Electronics (cat 1) and Home (cat 14).
  3. `Warm Revisit`: Returning to previously viewed category (Electronics).

## Verified Performance Comparison

| Metric | Baseline (`app.baseline.js`) | Optimized (`app.js`) | vs Baseline (% Δ) |
|---|---|---|---|
| **Cold Catalog Ready (Median)** | 81.89 ms (p95: 114.97 ms) | **82.15 ms** (p95: 113.54 ms) | -0.3% |
| **Sequence Transitions (Median)** | 228.62 ms | **229.06 ms** | — |
| **Warm Category Revisit (Median)** | 99.95 ms (p95: 100.52 ms) | **74.02 ms** (p95: 74.75 ms) | **+25.9%** (faster) |
| **Warm Revisit API Response-Body Bytes** | 80.7 KiB | **0.0 KiB** | **+100%** (saved) |
| **Warm Revisit API Requests** | 1 reqs | **0 reqs** | — |
| **JavaScript / Console Errors** | 0 | **0** | **Zero errors** |

## Audit Methodology Notes

1. **Content & Readiness Assertions**:
   - Each transition asserts `aria-busy=false`, matching category dropdown value, exact result summary count (`204 results` / `198 results`), matching product metadata category, and 20 rendered rows.
   - Identical deterministic assertions applied to baseline and optimized conditions without altering runtime behavior.

2. **Explicit Response-Body Accounting**:
   - Every finite response body read is explicitly tracked and awaited via `Promise.all(pendingBodyReads)`, eliminating fixed time-based sleeps.
   - Decoded API response-body bytes are measured separately from transport wire traffic. Long-lived SSE stream is excluded.

3. **Counterbalanced Pair Execution**:
   - Alternated condition order (even pairs baseline-first, odd pairs optimized-first) across all 30 measured runs to eliminate thermal and OS cache bias.
