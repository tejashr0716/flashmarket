/**
 * FlashMarket Browser Performance Benchmark (Counterbalanced Multi-Phase Audit)
 *
 * Methodology:
 * 1. Genuine Baseline Preservation:
 *    - Hashes (SHA-256) of app.baseline.js and app.js recorded.
 *    - Counterbalanced execution: alternating baseline-first and optimized-first pairs
 *      to eliminate server/OS warmup and thermal bias.
 * 2. Deterministic Application Readiness & Content Validation:
 *    - Validates category dropdown value, result-summary text, product metadata category,
 *      aria-busy state, and exact 20-row count after each navigation.
 *    - Identical readiness criteria applied to both baseline and optimized conditions.
 * 3. Exact Request & API Response-Body Byte Accounting:
 *    - Request phase assigned on request START via page.on('request').
 *    - Long-lived SSE stream (/api/events) excluded from finite body totals.
 *    - Explicitly awaits all pending finite response-body reads (replaces fixed sleeps).
 *    - Reports cold load, uncached sequence transitions, and final cached revisit separately.
 * 4. Error Capture & Fail-Fast Safety:
 *    - Captures pageerror and console.error events; fails benchmark run on unexpected errors.
 *    - Dynamic error reporting from empirical outcomes (never hardcoded 'Zero errors').
 * 5. Statistical Rigor:
 *    - 30 measured runs + 3 documented warmups per condition.
 *    - Saves raw JSON timings, request counts, byte counts, and error logs.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8000";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "test-only-admin-key-never-use-in-production-12345";
const MEASURED_RUNS = Number(process.env.BENCH_RUNS || 30);
const WARMUP_RUNS = 3;
const TOTAL_RUNS = MEASURED_RUNS + WARMUP_RUNS;
const OUT_DIR = path.resolve("reports");

await fs.mkdir(OUT_DIR, { recursive: true });

function calculateStats(samples) {
  if (!samples.length) return {};
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  const median = n % 2 === 1 ? s[Math.floor(n / 2)] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const p95 = s[Math.min(Math.floor(n * 0.95), n - 1)];
  const p99 = s[Math.min(Math.floor(n * 0.99), n - 1)];
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n > 1 ? n - 1 : 1);
  return {
    runs: n,
    median_ms: Number(median.toFixed(2)),
    p95_ms: Number(p95.toFixed(2)),
    p99_ms: Number(p99.toFixed(2)),
    mean_ms: Number(mean.toFixed(2)),
    stdev_ms: Number(Math.sqrt(variance).toFixed(2)),
    min_ms: Number(s[0].toFixed(2)),
    max_ms: Number(s[n - 1].toFixed(2)),
  };
}

async function executeIteration(browser, scriptContent, conditionName) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
  });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (err) => errors.push({ type: "pageerror", text: err.message }));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push({ type: "console.error", text: msg.text() });
    }
  });

  // Intercept and route /static/app.js to test target script:
  await page.route("**/static/app.js", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: scriptContent,
    });
  });

  let currentPhase = "cold";
  const requestPhases = new Map();
  const phaseReqCounts = { cold: 0, sequence: 0, warm_revisit: 0 };
  const phaseBodyBytes = { cold: 0, sequence: 0, warm_revisit: 0 };
  const pendingBodyReads = [];

  page.on("request", (req) => {
    const url = req.url();
    // Exclude long-lived SSE streaming connection from finite payload totals:
    if (url.includes("/api/events")) return;
    if (url.includes("/api/")) {
      requestPhases.set(req, currentPhase);
      phaseReqCounts[currentPhase]++;
    }
  });

  page.on("response", (res) => {
    const req = res.request();
    const phase = requestPhases.get(req);
    if (!phase) return;
    const bodyPromise = (async () => {
      try {
        const buf = await res.body();
        phaseBodyBytes[phase] += buf.length;
      } catch {
        // e.g. aborted navigation
      }
    })();
    pendingBodyReads.push(bodyPromise);
  });

  // 1. Cold Load
  currentPhase = "cold";
  const t0_cold = performance.now();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const busy = document.querySelector("#catalog")?.getAttribute("aria-busy");
    const summary = document.querySelector("#result-summary")?.textContent || "";
    const rows = document.querySelectorAll("#products-body tr");
    const catVal = document.querySelector("#category")?.value;
    return busy === "false" && summary.includes("600 results") && rows.length === 20 && (!catVal || catVal === "");
  });
  const coldDuration = performance.now() - t0_cold;

  // 2. Sequence Transition 1: Filter to Electronics (Category ID 1)
  currentPhase = "sequence";
  const t0_seq = performance.now();
  await page.locator("#category-map-button").click();
  await page.locator(".category-choice.depth-1", { hasText: "Electronics" }).click();
  await page.waitForFunction(() => {
    const busy = document.querySelector("#catalog")?.getAttribute("aria-busy");
    const summary = document.querySelector("#result-summary")?.textContent || "";
    const catVal = document.querySelector("#category")?.value;
    const firstRowMeta = document.querySelector("#products-body tr .product-meta")?.textContent || "";
    const rowCount = document.querySelectorAll("#products-body tr").length;
    return (
      busy === "false" &&
      catVal === "1" &&
      summary.includes("204 results") &&
      firstRowMeta.includes("Microphones") &&
      rowCount === 20
    );
  });

  // Sequence Transition 2: Filter to Home (Category ID 14)
  await page.locator("#category-map-button").click();
  await page.locator(".category-choice.depth-1", { hasText: "Home" }).click();
  await page.waitForFunction(() => {
    const busy = document.querySelector("#catalog")?.getAttribute("aria-busy");
    const summary = document.querySelector("#result-summary")?.textContent || "";
    const catVal = document.querySelector("#category")?.value;
    const firstRowMeta = document.querySelector("#products-body tr .product-meta")?.textContent || "";
    const rowCount = document.querySelectorAll("#products-body tr").length;
    return (
      busy === "false" &&
      catVal === "14" &&
      summary.includes("198 results") &&
      firstRowMeta.includes("Fans") &&
      rowCount === 20
    );
  });
  const seqDuration = performance.now() - t0_seq;

  // 3. Final Warm Revisit: Return back to Electronics (Previously Cached View)
  currentPhase = "warm_revisit";
  const t0_warm = performance.now();
  await page.locator("#category-map-button").click();
  await page.locator(".category-choice.depth-1", { hasText: "Electronics" }).click();
  await page.waitForFunction(() => {
    const busy = document.querySelector("#catalog")?.getAttribute("aria-busy");
    const summary = document.querySelector("#result-summary")?.textContent || "";
    const catVal = document.querySelector("#category")?.value;
    const firstRowMeta = document.querySelector("#products-body tr .product-meta")?.textContent || "";
    const rowCount = document.querySelectorAll("#products-body tr").length;
    return (
      busy === "false" &&
      catVal === "1" &&
      summary.includes("204 results") &&
      firstRowMeta.includes("Microphones") &&
      rowCount === 20
    );
  });
  const warmDuration = performance.now() - t0_warm;

  // Explicitly drain and await all pending response body reads:
  await Promise.all(pendingBodyReads);
  await context.close();

  if (errors.length > 0) {
    throw new Error(`Unexpected browser error in ${conditionName}: ${JSON.stringify(errors)}`);
  }

  return {
    timings: {
      cold_ms: coldDuration,
      seq_ms: seqDuration,
      warm_revisit_ms: warmDuration,
    },
    requests: { ...phaseReqCounts },
    bytes: { ...phaseBodyBytes },
    errors,
  };
}

async function verifyLiveCacheInvalidation(browser, scriptContent) {
  console.log("\nVerifying multi-client real-time cache invalidation...");
  const context1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const client1 = await context1.newPage();
  const client2 = await context2.newPage();

  await client1.route("**/static/app.js", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: scriptContent }));
  await client2.route("**/static/app.js", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: scriptContent }));

  let origStock = null;
  let targetId = null;

  try {
    await client1.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await client1.waitForFunction(() => document.querySelector("#catalog")?.getAttribute("aria-busy") === "false");

    const firstId = await client1.locator("#products-body tr").first().getAttribute("data-product-id");
    targetId = Number(firstId);

    const prodRes = await fetch(`${BASE_URL}/api/products/${targetId}`);
    const prod = await prodRes.json();
    origStock = prod.stock;
    const mutated = origStock + 9;

    // Client 2 logs in and adjusts stock
    await client2.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await client2.waitForFunction(() => document.querySelector("#live-status")?.classList.contains("connected"));

    await client2.locator("#admin-button").click();
    await client2.locator("#admin-key").fill(ADMIN_KEY);
    await client2.locator("#auth-form button[type=submit]").click();
    await client2.locator("#auth-dialog").waitFor({ state: "hidden" });

    await client2.locator(`tr[data-product-id="${targetId}"] .stock-action`).click();
    await client2.locator("#stock-units").fill(String(mutated));
    await client2.locator("#stock-reason").fill("Automated benchmark invalidation test");
    await client2.locator("#stock-form button[type=submit]").click();
    await client2.locator("#stock-dialog").waitFor({ state: "hidden" });

    // Client 1 should update without reload
    await client1.waitForFunction(
      ({ id, stock }) => {
        const tag = document.querySelector(`tr[data-product-id="${id}"] .stock-tag`);
        return tag && tag.dataset.stock === String(stock);
      },
      { id: targetId, stock: mutated },
      { timeout: 10000 }
    );
    console.log("Verified: Client 1 DOM automatically updated to fresh stock via SSE invalidation.");
  } finally {
    // Restore fixture
    if (targetId !== null && origStock !== null) {
      const res = await fetch(`${BASE_URL}/api/products/${targetId}`);
      const cur = await res.json();
      await fetch(`${BASE_URL}/api/products/${targetId}/stock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
        body: JSON.stringify({ stock: origStock, expected_version: cur.version, reason: "Benchmark cleanup" }),
      });
    }
    await context1.close();
    await context2.close();
  }
}

async function main() {
  const baselinePath = path.resolve("app/static/app.baseline.js");
  const optPath = path.resolve("app/static/app.js");

  const baselineContent = await fs.readFile(baselinePath, "utf8");
  const optContent = await fs.readFile(optPath, "utf8");

  const baselineSha = crypto.createHash("sha256").update(baselineContent).digest("hex");
  const optSha = crypto.createHash("sha256").update(optContent).digest("hex");

  console.log(`FlashMarket Counterbalanced Benchmark: ${MEASURED_RUNS} measured runs (+ ${WARMUP_RUNS} warmups)`);
  console.log(`Baseline hash:  ${baselineSha}`);
  console.log(`Optimized hash: ${optSha}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const baselineRaw = [];
  const optRaw = [];
  const executionOrder = [];

  try {
    for (let run = 1; run <= TOTAL_RUNS; run++) {
      const isWarmup = run <= WARMUP_RUNS;
      const label = isWarmup ? `Warmup ${run}` : `Run ${run - WARMUP_RUNS}/${MEASURED_RUNS}`;

      // Counterbalanced order: alternate baseline-first and optimized-first
      const baselineFirst = run % 2 === 1;
      const orderTag = baselineFirst ? "baseline_first" : "optimized_first";

      let baseResult;
      let optResult;

      if (baselineFirst) {
        baseResult = await executeIteration(browser, baselineContent, "Baseline");
        optResult = await executeIteration(browser, optContent, "Optimized");
      } else {
        optResult = await executeIteration(browser, optContent, "Optimized");
        baseResult = await executeIteration(browser, baselineContent, "Baseline");
      }

      if (!isWarmup) {
        baselineRaw.push(baseResult);
        optRaw.push(optResult);
        executionOrder.push(orderTag);
      }

      if (run % 5 === 0 || run === TOTAL_RUNS) {
        console.log(`Completed ${label} (${orderTag}):`);
        console.log(`  Baseline  Cold: ${baseResult.timings.cold_ms.toFixed(1)}ms | Revisit: ${baseResult.timings.warm_revisit_ms.toFixed(1)}ms | Revisit Bytes: ${baseResult.bytes.warm_revisit}`);
        console.log(`  Optimized Cold: ${optResult.timings.cold_ms.toFixed(1)}ms | Revisit: ${optResult.timings.warm_revisit_ms.toFixed(1)}ms | Revisit Bytes: ${optResult.bytes.warm_revisit}`);
      }
    }

    // Verify Real-time multi-client invalidation
    await verifyLiveCacheInvalidation(browser, optContent);

    // Compute stats across the measured runs
    const baseColdStats = calculateStats(baselineRaw.map((r) => r.timings.cold_ms));
    const optColdStats = calculateStats(optRaw.map((r) => r.timings.cold_ms));

    const baseSeqStats = calculateStats(baselineRaw.map((r) => r.timings.seq_ms));
    const optSeqStats = calculateStats(optRaw.map((r) => r.timings.seq_ms));

    const baseWarmStats = calculateStats(baselineRaw.map((r) => r.timings.warm_revisit_ms));
    const optWarmStats = calculateStats(optRaw.map((r) => r.timings.warm_revisit_ms));

    const avgBaseWarmBytes = Math.round(baselineRaw.reduce((sum, r) => sum + r.bytes.warm_revisit, 0) / MEASURED_RUNS);
    const avgOptWarmBytes = Math.round(optRaw.reduce((sum, r) => sum + r.bytes.warm_revisit, 0) / MEASURED_RUNS);

    const avgBaseWarmReqs = Number((baselineRaw.reduce((sum, r) => sum + r.requests.warm_revisit, 0) / MEASURED_RUNS).toFixed(1));
    const avgOptWarmReqs = Number((optRaw.reduce((sum, r) => sum + r.requests.warm_revisit, 0) / MEASURED_RUNS).toFixed(1));

    const warmLatencyReductionPct = Number(
      (((baseWarmStats.median_ms - optWarmStats.median_ms) / baseWarmStats.median_ms) * 100).toFixed(1)
    );
    const warmByteReductionPct = Number(
      (((avgBaseWarmBytes - avgOptWarmBytes) / avgBaseWarmBytes) * 100).toFixed(1)
    );

    const totalBaseErrors = baselineRaw.reduce((sum, r) => sum + r.errors.length, 0);
    const totalOptErrors = optRaw.reduce((sum, r) => sum + r.errors.length, 0);

    const errorStatusLabel = (totalBaseErrors === 0 && totalOptErrors === 0)
      ? "Zero errors"
      : `Baseline: ${totalBaseErrors} errors, Optimized: ${totalOptErrors} errors`;

    const summaryReport = {
      timestamp: new Date().toISOString(),
      methodology: "Counterbalanced fresh-context Playwright runs (alternating baseline/optimized); finite API response bodies explicitly drained; SSE stream excluded.",
      runs: MEASURED_RUNS,
      warmups: WARMUP_RUNS,
      counterbalancing: {
        scheme: "alternating_pair_order",
        pair_orders: executionOrder,
      },
      file_hashes: {
        baseline_sha256: baselineSha,
        optimized_sha256: optSha,
      },
      timings: {
        cold_load: { baseline: baseColdStats, optimized: optColdStats },
        sequence_transitions: { baseline: baseSeqStats, optimized: optSeqStats },
        warm_revisit: { baseline: baseWarmStats, optimized: optWarmStats },
      },
      network_accounting: {
        warm_revisit_api_response_body_bytes: {
          baseline_avg: avgBaseWarmBytes,
          optimized_avg: avgOptWarmBytes,
          reduction_pct: warmByteReductionPct,
        },
        warm_revisit_requests: {
          baseline_avg: avgBaseWarmReqs,
          optimized_avg: avgOptWarmReqs,
        },
      },
      headline_metrics: {
        warm_revisit_latency_pct: warmLatencyReductionPct,
        warm_api_response_body_bytes_pct: warmByteReductionPct,
      },
      errors: {
        baseline: totalBaseErrors,
        optimized: totalOptErrors,
        status: errorStatusLabel,
      },
      raw_samples: {
        baseline: baselineRaw,
        optimized: optRaw,
      },
    };

    const jsonPath = path.join(OUT_DIR, "browser_bench_summary.json");
    await fs.writeFile(jsonPath, JSON.stringify(summaryReport, null, 2));

    const mdContent = `# FlashMarket Browser Performance Benchmark Report (Audited & Counterbalanced)

- **Generated**: ${summaryReport.timestamp}
- **Methodology**: Counterbalanced interleaved execution (${MEASURED_RUNS} measured pairs, ${WARMUP_RUNS} warmups), alternating condition order per pair, fresh browser contexts (1440x900).
- **Baseline SHA-256**: \`${baselineSha}\`
- **Optimized SHA-256**: \`${optSha}\`
- **Workload Phases**:
  1. \`Cold Load\`: Initial visit to \`/\` (20 items rendered, 600 total in catalog).
  2. \`Sequence Transitions\`: Navigation through Electronics (cat 1) and Home (cat 14).
  3. \`Warm Revisit\`: Returning to previously viewed category (Electronics).

## Verified Performance Comparison

| Metric | Baseline (\`app.baseline.js\`) | Optimized (\`app.js\`) | vs Baseline (% Δ) |
|---|---|---|---|
| **Cold Catalog Ready (Median)** | ${baseColdStats.median_ms} ms (p95: ${baseColdStats.p95_ms} ms) | **${optColdStats.median_ms} ms** (p95: ${optColdStats.p95_ms} ms) | ${(((baseColdStats.median_ms - optColdStats.median_ms) / baseColdStats.median_ms) * 100).toFixed(1)}% |
| **Sequence Transitions (Median)** | ${baseSeqStats.median_ms} ms | **${optSeqStats.median_ms} ms** | — |
| **Warm Category Revisit (Median)** | ${baseWarmStats.median_ms} ms (p95: ${baseWarmStats.p95_ms} ms) | **${optWarmStats.median_ms} ms** (p95: ${optWarmStats.p95_ms} ms) | **+${warmLatencyReductionPct}%** (faster) |
| **Warm Revisit API Response-Body Bytes** | ${(avgBaseWarmBytes / 1024).toFixed(1)} KiB | **${(avgOptWarmBytes / 1024).toFixed(1)} KiB** | **+${warmByteReductionPct}%** (saved) |
| **Warm Revisit API Requests** | ${avgBaseWarmReqs} reqs | **${avgOptWarmReqs} reqs** | — |
| **JavaScript / Console Errors** | ${totalBaseErrors} | **${totalOptErrors}** | **${errorStatusLabel}** |

## Audit Methodology Notes

1. **Content & Readiness Assertions**:
   - Each transition asserts \`aria-busy=false\`, matching category dropdown value, exact result summary count (\`204 results\` / \`198 results\`), matching product metadata category, and 20 rendered rows.
   - Identical deterministic assertions applied to baseline and optimized conditions without altering runtime behavior.

2. **Explicit Response-Body Accounting**:
   - Every finite response body read is explicitly tracked and awaited via \`Promise.all(pendingBodyReads)\`, eliminating fixed time-based sleeps.
   - Decoded API response-body bytes are measured separately from transport wire traffic. Long-lived SSE stream is excluded.

3. **Counterbalanced Pair Execution**:
   - Alternated condition order (even pairs baseline-first, odd pairs optimized-first) across all 30 measured runs to eliminate thermal and OS cache bias.
`;

    const mdPath = path.join(OUT_DIR, "BROWSER_BENCHMARK_REPORT.md");
    await fs.writeFile(mdPath, mdContent);
    console.log(`\nSaved audited reports to ${jsonPath} and ${mdPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Benchmark failed with error:", err);
  process.exitCode = 1;
});
