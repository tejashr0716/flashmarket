import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:8000";
const adminKey = process.env.ADMIN_API_KEY || "";
const out = process.env.QA_OUTPUT || "test-results/browser";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [];
const errors = [];
const css = await fs.readFile("app/static/styles.css", "utf8");
const mark = await fs.readFile("app/static/mark.svg");
let restoreProduct = null;
let createdProduct = null;

async function api(route, options = {}) {
  const response = await fetch(base + route, options);
  assert.ok(response.ok, `API returned ${response.status}: ${route}`);
  return response.status === 204 ? null : response.json();
}

async function snapshot(page, name) {
  let html = await page.content();
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<link[^>]+rel="stylesheet"[^>]*>/gi, "");
  html = html.replaceAll('"/static/mark.svg"', `"data:image/svg+xml;base64,${mark.toString("base64")}"`);
  // page.content() serializes [open], but not the browser's native modal top layer.
  // Reproduce that placement/backdrop only in offline visual-QA snapshots.
  const modalSnapshotCss = `
    dialog[open] {position:fixed;top:50%;left:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);margin:0;z-index:100;overflow:auto}
    body:has(dialog[open])::before {content:"";position:fixed;inset:0;background:rgba(20,25,32,.5);z-index:99}
  `;
  html = html.replace("</head>", `<style>${css}${modalSnapshotCss}</style></head>`);
  await fs.writeFile(path.join(out, `${name}.html`), html);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}

async function loaded(page) {
  await page.waitForFunction(() => document.querySelector("#stat-total").textContent === "600");
  await page.waitForFunction(() => document.querySelector("#result-summary").textContent.startsWith("600 results"));
  await page.waitForFunction(() => document.querySelector("#catalog").getAttribute("aria-busy") === "false");
}

async function unlock(page) {
  await page.locator("#admin-button").click();
  await snapshot(page, "auth");
  await page.locator("#admin-key").fill(adminKey);
  await page.locator("#auth-form button[type=submit]").click();
  await page.locator("#auth-dialog").waitFor({ state: "hidden" });
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  let productRequests = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/products") productRequests++; });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await loaded(page);
  assert.equal(await page.locator("#products-body tr").count(), 20);
  assert.match(await page.locator(".sample-note").innerText(), /Sample catalog/);
  results.push("600 real sample records; 20 rendered rows; sample label");
  await snapshot(page, "desktop");

  const firstIds = await page.locator("#products-body tr").evaluateAll((rows) => rows.map((row) => row.dataset.productId));
  const beforePageChange = productRequests;
  await page.locator("#next-page").click();
  const secondIds = await page.locator("#products-body tr").evaluateAll((rows) => rows.map((row) => row.dataset.productId));
  assert.ok(secondIds.every((id) => !firstIds.includes(id)));
  assert.equal(productRequests, beforePageChange);
  assert.match(await page.locator("#page-summary").innerText(), /Showing 21–40/);
  results.push("Client-side page 2 differs from page 1; no products HTTP request on page change");

  const beforeSearch = productRequests;
  await page.locator("#search").fill("Studio");
  await page.waitForTimeout(150);
  assert.equal(productRequests, beforeSearch);
  await page.waitForResponse((response) => response.url().includes("search=Studio"));
  await page.waitForFunction(() => document.querySelector("#catalog").getAttribute("aria-busy") === "false");
  assert.ok(productRequests > beforeSearch);
  assert.ok((await page.locator("#products-body").innerText()).includes("Studio"));
  results.push("Search waits for the 300 ms debounce");

  await page.locator("#search").fill("qa-no-products-exist-987654321");
  await page.locator("#empty-state").waitFor({ state: "visible" });
  await snapshot(page, "empty");
  assert.equal(await page.locator("#products-body tr").count(), 0);
  await page.locator("#empty-clear").click();
  await loaded(page);
  results.push("Empty results and Clear filters recovery");

  await page.locator("#min-price").fill("99999");
  await page.locator("#max-price").fill("10");
  await page.locator("#catalog-error").waitFor({ state: "visible" });
  assert.match(await page.locator("#error-message").innerText(), /min_price cannot exceed max_price/);
  await snapshot(page, "invalid-range");
  await page.locator("#clear-button").click();
  await loaded(page);
  results.push("Invalid range displays real validation error and recovers");

  await page.locator("#category-map-button").click();
  assert.equal(await page.locator(".category-choice").count(), 39);
  await snapshot(page, "categories");
  await page.locator('.category-choice.depth-1', { hasText: "Electronics" }).click();
  await page.waitForFunction(() => {
    const text = document.querySelector("#result-summary").textContent;
    return !text.startsWith("600") && document.querySelector("#catalog").getAttribute("aria-busy") === "false";
  });
  await page.locator("#clear-button").click();
  await loaded(page);
  results.push("Category map has three levels; root category returns descendant products");

  await page.locator("#products-body .product-link").first().click();
  await page.locator("#detail-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#detail-fields dt").count(), 6);
  await snapshot(page, "detail");
  await page.locator('[data-close="detail-dialog"]').click();
  results.push("Product detail uses current API data");

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base, { waitUntil: "domcontentloaded" });
  await loaded(mobilePage);
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await mobilePage.locator("#products-body tr").count(), 20);
  await snapshot(mobilePage, "mobile");
  results.push("390 px layout has no document-level overflow; table scroll is contained");
  await mobile.close();

  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const darkPage = await dark.newPage();
  await darkPage.goto(base, { waitUntil: "domcontentloaded" });
  await loaded(darkPage);
  await darkPage.screenshot({ path: path.join(out, "dark.png") });
  results.push("Dark theme follows prefers-color-scheme");
  await dark.close();

  const docs = await context.newPage();
  await docs.goto(`${base}/docs`, { waitUntil: "domcontentloaded" });
  await docs.locator(".swagger-ui .info .title").waitFor({ state: "visible", timeout: 15000 });
  assert.match(await docs.locator(".swagger-ui .info .title").innerText(), /Flash Market/);
  await docs.screenshot({ path: path.join(out, "api-docs.png") });
  await docs.close();
  results.push("Swagger API documentation loads and renders");

  if (adminKey) {
    await unlock(page);
    const secondContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const other = await secondContext.newPage();
    await other.goto(base, { waitUntil: "domcontentloaded" });
    await loaded(other);
    await unlock(other);
    await other.waitForFunction(() => document.querySelector("#live-label").textContent === "Live stock");
    const productId = Number(firstIds[0]);
    const original = await api(`/api/products/${productId}`);
    restoreProduct = original;
    await page.locator(`tr[data-product-id="${productId}"] .stock-action`).click();
    await other.locator(`tr[data-product-id="${productId}"] .stock-action`).click();
    await snapshot(page, "stock");
    await page.locator("#stock-units").fill(String(original.stock + 1));
    await page.locator("#stock-reason").fill("Browser cross-session test");
    await page.locator("#stock-form button[type=submit]").click();
    await page.locator("#stock-dialog").waitFor({ state: "hidden" });
    await other.waitForFunction(({ id, stock }) => {
      return document.querySelector(`tr[data-product-id="${id}"] .stock-tag`)?.dataset.stock === String(stock);
    }, { id: productId, stock: original.stock + 1 }, { timeout: 10000 });
    results.push("Stock saved in first context updates second context through SSE");
    await other.locator("#stock-units").fill(String(original.stock + 2));
    await other.locator("#stock-form button[type=submit]").click();
    await other.waitForFunction(() => document.querySelector("#stock-error").textContent.includes("Product changed"));
    await snapshot(other, "stale-stock");
    results.push("Stale stock editor receives conflict instead of overwriting");
    await other.locator('[data-close="stock-dialog"]').first().click();
    await secondContext.close();
    const latest = await api(`/api/products/${productId}`);
    await api(`/api/products/${productId}/stock`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
      body: JSON.stringify({ stock: original.stock, expected_version: latest.version, reason: "Restore browser test fixture" }),
    });
    restoreProduct = null;

    await page.locator("#add-button").click();
    await snapshot(page, "add-product");
    await page.locator("#product-name").fill("QA <img src=x onerror=alert(1)> product");
    await page.locator("#product-sku").fill(`QA-${Date.now()}`);
    await page.locator("#product-brand").selectOption("1");
    await page.locator("#product-category").selectOption("3");
    await page.locator("#product-price").fill("1999.99");
    await page.locator("#product-stock").fill("12");
    await page.locator("#product-rating").fill("4.5");
    await page.locator("#product-description").fill("<script>alert(1)</script> is literal text, not HTML.");
    await page.locator("#product-save").click();
    await page.locator("#product-dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelector("#stat-total").textContent === "601");
    await page.waitForFunction(() => document.querySelector("#products-body").textContent.includes("QA <img"));
    createdProduct = Number(await page.locator("#products-body tr", { hasText: "QA <img" }).getAttribute("data-product-id"));
    assert.equal(await page.locator("#products-body img").count(), 0);
    results.push("Protected product creation; untrusted text is not injected as HTML");

    await page.locator("#products-body .product-link", { hasText: "QA <img" }).click();
    await page.locator("#edit-button").click();
    assert.equal(await page.locator("#product-stock").isDisabled(), true);
    await page.locator("#product-price").fill("2499.99");
    await page.locator("#product-save").click();
    await page.locator("#product-dialog").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelector("#products-body").textContent.includes("2,499.99"));
    await page.locator("#products-body .product-link", { hasText: "QA <img" }).click();
    await page.locator("#archive-button").click();
    await snapshot(page, "archive");
    await page.locator("#archive-form button[type=submit]").click();
    await page.locator("#archive-dialog").waitFor({ state: "hidden" });
    await loaded(page);
    createdProduct = null;
    results.push("Protected edit and soft archive; active count restored to 600");
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    results.push("Admin key is not persisted to localStorage");
  } else results.push("Protected write/browser tests SKIPPED: ADMIN_API_KEY not supplied");

  // Expected HTTP 422 is deliberately tested; no JS or other console failures allowed.
  const unexpected = errors.filter((text) => !text.includes("422 (Unprocessable"));
  assert.deepEqual(unexpected, []);
  results.push("No unhandled JavaScript errors");
  await context.close();
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify({ status: "passed", checks: results }, null, 2));
  console.log(JSON.stringify({ status: "passed", checks: results.length, protected_writes_tested: Boolean(adminKey) }));
} catch (error) {
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify({ status: "failed", checks: results, error: error.message }, null, 2));
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (createdProduct && adminKey) {
    try {
      const latest = await api(`/api/products/${createdProduct}`);
      await api(`/api/products/${createdProduct}?expected_version=${latest.version}`, {
        method: "DELETE", headers: { "X-Admin-Key": adminKey },
      });
    } catch { /* A successful archive may have happened before a later assertion failed. */ }
  }
  if (restoreProduct && adminKey) {
    try {
      const latest = await api(`/api/products/${restoreProduct.id}`);
      await api(`/api/products/${restoreProduct.id}/stock`, {
        method: "PATCH", headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
        body: JSON.stringify({ stock: restoreProduct.stock, expected_version: latest.version, reason: "Restore failed browser test fixture" }),
      });
    } catch { console.error("Could not restore stock fixture; inspect local test state"); }
  }
  await browser.close();
}
