# FlashMarket Browser Performance Benchmark Report (Audited)

- **Generated**: 2026-10-22T17:00:33.108Z
- **Methodology**: Interleaved execution (30 measured pairs, 3 warmups), fresh browser contexts (1440x900).
- **Baseline SHA-256**: `5f6276651f80284764d57f67d2861549f28a57049d59b86430e1e5926ff79fe0`
- **Optimized SHA-256**: `88ec8c56caaa184227f42d72fc8d82b6929b7a7aab9fe432c25f4eb5428773db`
- **Workload Phases**:
  1. `Cold Load`: Initial visit to `/` (20 items rendered, 600 total in catalog).
  2. `Sequence Transitions`: Navigation through Electronics and Home categories.
  3. `Warm Revisit`: Returning to previously viewed category (Electronics).

## Verified Performance Comparison

| Metric | Baseline (`app.baseline.js`) | Optimized (`app.js`) | vs Baseline (% Δ) |
|---|---|---|---|
| **Cold Catalog Ready (Median)** | 81.88 ms (p95: 113.68 ms) | **81.32 ms** (p95: 98.35 ms) | 0.7% |
| **Sequence Transitions (Median)** | 228.59 ms | **228.97 ms** | — |
| **Warm Category Revisit (Median)** | 99.87 ms (p95: 100.67 ms) | **73.97 ms** (p95: 74.69 ms) | **+25.9%** (faster) |
| **Warm Revisit Transferred API Bytes** | 80.7 KB | **0.0 KB** | **+100%** (saved) |
| **Warm Revisit API Requests** | 1 reqs | **0 reqs** | — |
| **JavaScript / Console Errors** | 0 | **0** | **Zero errors** |

## Audit Resolutions

1. **Stale Cache Repopulation & Epochs**:
   - Integrated `ClientResponseCache` with generation/epoch numbers.
   - If an invalidation occurs while an in-flight request is resolving, the returned payload's epoch does not match current epoch, preventing stale data from repopulating the cache.
   - Newer requests arriving after an invalidation are blocked from joining obsolete in-flight promises.

2. **Unhandled Promise Rejections**:
   - The promise returned by `.finally()` is assigned and returned directly, eliminating unhandled sibling promise rejections on network failures while preserving rejection handling for callers.

3. **Accurate Accounting**:
   - Each HTTP request is assigned to its execution phase at request **start** (`page.on('request')`).
   - Long-lived Server-Sent Events stream (`/api/events`) is excluded from finite body byte totals.
   - Transition sequence is reported separately from the warm revisit.
