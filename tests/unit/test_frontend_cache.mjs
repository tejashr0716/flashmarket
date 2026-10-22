import assert from "node:assert/strict";
import test from "node:test";

// Implement the identical ClientResponseCache class to test epoch & in-flight logic
class ClientResponseCache {
  constructor(defaultTtlMs = 60000) {
    this.defaultTtl = defaultTtlMs;
    this.cache = new Map();
    this.inFlight = new Map();
    this.epoch = 0;
    this.nextId = 0;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt || entry.epoch !== this.epoch) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data, requestEpoch, ttlMs = this.defaultTtl) {
    if (requestEpoch !== this.epoch) {
      return false; // Stale repopulation prevented
    }
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs, epoch: requestEpoch });
    return true;
  }

  getInFlight(key) {
    const flight = this.inFlight.get(key);
    if (!flight) return null;
    if (flight.epoch !== this.epoch) {
      return null; // Obsolete in-flight request rejected
    }
    return flight.promise;
  }

  setInFlight(key, promise, epoch) {
    const id = ++this.nextId;
    this.inFlight.set(key, { promise, epoch, id });
    return id;
  }

  clearInFlight(key, id) {
    const current = this.inFlight.get(key);
    if (current && current.id === id) {
      this.inFlight.delete(key);
      return true;
    }
    return false;
  }

  invalidate(pattern) {
    this.epoch++;
    if (!pattern) {
      this.cache.clear();
      this.inFlight.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.inFlight.keys()) {
      if (key.includes(pattern)) {
        this.inFlight.delete(key);
      }
    }
  }
}

test("stale cache repopulation is prevented when invalidation occurs during in-flight fetch", () => {
  const cache = new ClientResponseCache();
  const startEpoch = cache.epoch; // 0

  // An invalidation happens while request is in-flight:
  cache.invalidate("/api/products");
  assert.equal(cache.epoch, 1);

  // Older in-flight fetch finishes and attempts to set:
  const saved = cache.set("/api/products?cat=1", { items: ["stale"] }, startEpoch);
  assert.equal(saved, false);
  assert.equal(cache.get("/api/products?cat=1"), null);
});

test("new requests arriving after invalidation do not join obsolete in-flight work", () => {
  const cache = new ClientResponseCache();
  const slowPromise = new Promise(() => {}); // never resolves
  cache.setInFlight("/api/products?cat=1", slowPromise, cache.epoch);

  // Invalidation occurs:
  cache.invalidate("/api/products");

  // Newer request arrives after invalidation:
  const joinedFlight = cache.getInFlight("/api/products?cat=1");
  assert.equal(joinedFlight, null, "Should not join obsolete in-flight promise from older epoch");
});

test("older request cleanup does not delete a newer in-flight entry", () => {
  const cache = new ClientResponseCache();
  const p1 = Promise.resolve("old");
  const id1 = cache.setInFlight("/api/products", p1, cache.epoch);

  // A newer request replaces the in-flight slot:
  const p2 = Promise.resolve("new");
  const id2 = cache.setInFlight("/api/products", p2, cache.epoch);
  assert.notEqual(id1, id2);

  // Older request cleans up:
  const deletedOld = cache.clearInFlight("/api/products", id1);
  assert.equal(deletedOld, false, "Older request must not delete newer in-flight slot");
  assert.ok(cache.inFlight.has("/api/products"));
  assert.equal(cache.inFlight.get("/api/products").id, id2);

  // Newer request cleans up:
  const deletedNew = cache.clearInFlight("/api/products", id2);
  assert.equal(deletedNew, true);
  assert.equal(cache.inFlight.has("/api/products"), false);
});

test("failed requests handled in finally do not trigger unhandledRejection when replaced", async () => {
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);

  const cache = new ClientResponseCache();
  const path = "/api/test-failure";
  const reqEpoch = cache.epoch;

  let fetchPromise = Promise.reject(new Error("Simulated 500 Network Error"));
  const inFlightId = cache.setInFlight(path, fetchPromise, reqEpoch);

  // Replace the ignored promise returned by fetchPromise.finally():
  fetchPromise = fetchPromise.finally(() => {
    cache.clearInFlight(path, inFlightId);
  });

  // Caller catches the replaced promise:
  await assert.rejects(fetchPromise, /Simulated 500 Network Error/);

  // In-flight slot is cleared:
  assert.equal(cache.inFlight.has(path), false);

  await new Promise((r) => setTimeout(r, 50));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, false, "No unhandled rejection should occur");
});
