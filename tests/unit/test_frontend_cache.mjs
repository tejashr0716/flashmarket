import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

// Load actual production source from app/static/app.js directly (no duplicated classes):
const appJsPath = path.resolve("app/static/app.js");
const appSource = fs.readFileSync(appJsPath, "utf8").split("function toast(")[0];

function createAppContext(customFetch) {
  let fetchFn = customFetch;
  if (!fetchFn) {
    fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ stock: 10 }),
    });
  }

  const ctx = vm.createContext({
    Intl,
    Map,
    Date,
    JSON,
    setTimeout,
    clearTimeout,
    fetch: (...args) => fetchFn(...args),
    console,
  });

  vm.runInContext(
    appSource + "\n; globalThis.__api = { ClientResponseCache, responseCache, request, state };",
    ctx
  );
  return { ctx, api: ctx.__api, setFetch: (fn) => { fetchFn = fn; } };
}

test("stale cache repopulation is prevented when invalidation occurs during in-flight fetch", async () => {
  let releaseFirstFetch;
  let fetchCount = 0;

  const { api } = createAppContext(async () => {
    fetchCount++;
    if (fetchCount === 1) {
      return new Promise((resolve) => {
        releaseFirstFetch = resolve;
      });
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ stock: 42, version: 2 }),
    };
  });

  // Start in-flight request:
  const firstReq = api.request("/api/products?cat=1");

  // Invalidation occurs while request is in-flight:
  api.responseCache.invalidate("/api/products");

  // In-flight fetch resolves with older/stale data:
  releaseFirstFetch({
    ok: true,
    status: 200,
    json: async () => ({ stock: 5, version: 1 }),
  });
  await firstReq;

  // Stale data must NOT have repopulated the cache:
  assert.equal(api.responseCache.get("/api/products?cat=1"), null);

  // Subsequent request fetches fresh data:
  const fresh = await api.request("/api/products?cat=1");
  assert.equal(fresh.stock, 42);
  assert.equal(fetchCount, 2);
});

test("new requests arriving after invalidation do not join obsolete in-flight work", () => {
  const { api } = createAppContext();
  const c = api.responseCache;
  const slowPromise = new Promise(() => {}); // never resolves
  c.setInFlight("/api/products?cat=1", slowPromise, c.epoch);

  // Invalidation occurs:
  c.invalidate("/api/products");

  // Newer request arrives after invalidation:
  const joinedFlight = c.getInFlight("/api/products?cat=1");
  assert.equal(joinedFlight, null, "Should not join obsolete in-flight promise from older epoch");
});

test("older request cleanup does not delete a newer in-flight entry", () => {
  const { api } = createAppContext();
  const c = api.responseCache;
  const p1 = Promise.resolve("old");
  const id1 = c.setInFlight("/api/products", p1, c.epoch);

  // A newer request replaces the in-flight slot:
  const p2 = Promise.resolve("new");
  const id2 = c.setInFlight("/api/products", p2, c.epoch);
  assert.notEqual(id1, id2);

  // Older request cleans up:
  c.clearInFlight("/api/products", id1);
  assert.ok(c.inFlight.has("/api/products"));
  assert.equal(c.inFlight.get("/api/products").id, id2);

  // Newer request cleans up:
  c.clearInFlight("/api/products", id2);
  assert.equal(c.inFlight.has("/api/products"), false);
});

test("concurrent callers receive handled failures without unhandled rejections", async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e?.message || String(e));
  process.on("unhandledRejection", onUnhandled);

  const { api } = createAppContext(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ detail: "Simulated backend outage" }),
  }));

  // Two concurrent deduplicated callers:
  const outcomes = await Promise.allSettled([
    api.request("/api/products?failure_test=1"),
    api.request("/api/products?failure_test=1"),
  ]);

  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((x) => x.status === "rejected"));
  assert.ok(outcomes[0].reason.message.includes("Simulated backend outage"));

  await new Promise((r) => setTimeout(r, 60));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled.length, 0, `No unhandled rejections should occur: ${JSON.stringify(unhandled)}`);
});
