/**
 * Multi-Client Real-Time SSE Cache Invalidation Test
 *
 * Requirements:
 * 1. Two separate browser contexts.
 * 2. Mutate stock from Client 2.
 * 3. Verify Client 1 receives fresh data through SSE cache invalidation without manual refresh.
 * 4. Verify SSE reconnect invalidates stale cached views.
 * 5. Restore modified fixtures in finally.
 */

import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8000";
const ADMIN_KEY = process.env.ADMIN_API_KEY || "test-only-admin-key-never-use-in-production-12345";

async function unlockAdmin(page) {
  await page.locator("#admin-button").click();
  await page.locator("#admin-key").fill(ADMIN_KEY);
  await page.locator("#auth-form button[type=submit]").click();
  await page.locator("#auth-dialog").waitFor({ state: "hidden" });
}

async function run() {
  console.log("Starting multi-client real-time SSE cache invalidation test...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let originalStock = null;
  let targetProductId = null;

  try {
    const context1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    const client1 = await context1.newPage();
    const client2 = await context2.newPage();

    const client1Errors = [];
    client1.on("pageerror", (err) => client1Errors.push(err.message));
    client1.on("console", (msg) => { if (msg.type() === "error") client1Errors.push(msg.text()); });

    // Client 1 opens catalog and connects to SSE
    await client1.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await client1.waitForFunction(() => {
      const busy = document.querySelector("#catalog")?.getAttribute("aria-busy");
      const connected = document.querySelector("#live-status")?.classList.contains("connected");
      const rows = document.querySelectorAll("#products-body tr");
      return busy === "false" && connected && rows.length === 20;
    });

    const firstId = await client1.locator("#products-body tr").first().getAttribute("data-product-id");
    targetProductId = Number(firstId);

    // Get current stock
    const prodRes = await fetch(`${BASE_URL}/api/products/${targetProductId}`);
    const prodData = await prodRes.json();
    originalStock = prodData.stock;
    const mutatedStock = originalStock + 7;

    console.log(`Target product #${targetProductId}: current stock = ${originalStock}, mutating to ${mutatedStock}`);

    // Client 2 opens catalog, unlocks admin, and mutates stock
    await client2.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await client2.waitForFunction(() => document.querySelector("#live-status")?.classList.contains("connected"));
    await unlockAdmin(client2);

    await client2.locator(`tr[data-product-id="${targetProductId}"] .stock-action`).click();
    await client2.locator("#stock-units").fill(String(mutatedStock));
    await client2.locator("#stock-reason").fill("Multi-client SSE invalidation verification");
    await client2.locator("#stock-form button[type=submit]").click();
    await client2.locator("#stock-dialog").waitFor({ state: "hidden" });

    // Client 1 must receive the SSE event, invalidate its cache, refetch, and update DOM WITHOUT manual reload
    console.log("Waiting for Client 1 to receive SSE invalidation and update DOM...");
    await client1.waitForFunction(
      ({ id, stock }) => {
        const tag = document.querySelector(`tr[data-product-id="${id}"] .stock-tag`);
        return tag && tag.dataset.stock === String(stock);
      },
      { id: targetProductId, stock: mutatedStock },
      { timeout: 10000 }
    );
    console.log("Client 1 successfully updated via SSE cache invalidation!");

    // Test SSE Reconnect Invalidation
    console.log("Testing reconnect cache invalidation on Client 1...");
    // Simulate disconnect on client1
    await client1.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    // Mutate stock while client1 is disconnected
    const reconnectStock = originalStock + 12;
    const latestRes = await fetch(`${BASE_URL}/api/products/${targetProductId}`);
    const latestData = await latestRes.json();
    await fetch(`${BASE_URL}/api/products/${targetProductId}/stock`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
      body: JSON.stringify({
        stock: reconnectStock,
        expected_version: latestData.version,
        reason: "Offline mutation during disconnect",
      }),
    });

    // Reconnect client1 (pageshow with persisted: true)
    await client1.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });

    // Client 1 reconnect must purge stale cache and update to reconnectStock
    await client1.waitForFunction(
      ({ id, stock }) => {
        const tag = document.querySelector(`tr[data-product-id="${id}"] .stock-tag`);
        return tag && tag.dataset.stock === String(stock);
      },
      { id: targetProductId, stock: reconnectStock },
      { timeout: 10000 }
    );
    console.log("Client 1 reconnect successfully purged stale cache and rendered fresh stock!");

    assert.deepEqual(client1Errors, [], "Client 1 should have zero unhandled errors");
    await context1.close();
    await context2.close();
    console.log("All real-time cache invalidation checks passed successfully!");
  } finally {
    // Restore fixture in finally
    if (targetProductId !== null && originalStock !== null) {
      try {
        console.log(`Restoring product #${targetProductId} stock back to ${originalStock}...`);
        const res = await fetch(`${BASE_URL}/api/products/${targetProductId}`);
        const data = await res.json();
        await fetch(`${BASE_URL}/api/products/${targetProductId}/stock`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
          body: JSON.stringify({
            stock: originalStock,
            expected_version: data.version,
            reason: "Restore test fixture in finally",
          }),
        });
        console.log("Fixture restored successfully.");
      } catch (err) {
        console.error("Failed to restore test fixture:", err);
      }
    }
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
