"use strict";

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 20;
const API_BATCH = 1000;
const MAX_CLIENT_RESULTS = 10000;
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const compactMoney = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("en-IN");
const state = {
  products: [], categories: [], brands: [], page: 1, adminKey: "",
  selected: null, stockProduct: null, editing: null, pendingAction: null,
  abort: null, generation: 0, searchTimer: null, eventTimer: null, toastTimer: null,
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function request(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      detail = Array.isArray(payload.detail)
        ? payload.detail.map((error) => error.msg).join("; ")
        : payload.detail || detail;
    } catch { /* The service may be temporarily unreachable. */ }
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

function toast(message) {
  clearTimeout(state.toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  state.toastTimer = setTimeout(() => { $("toast").hidden = true; }, 5000);
}

function filterQuery() {
  const query = new URLSearchParams();
  const mapping = {
    search: "search", category: "category_id", brand: "brand_id",
    "min-price": "min_price", "max-price": "max_price", rating: "min_rating",
    stock: "stock", sort: "sort",
  };
  for (const [id, key] of Object.entries(mapping)) {
    const value = $(id).value.trim();
    if (value) query.set(key, value);
  }
  query.set("limit", API_BATCH);
  return query;
}

async function loadProducts({ resetPage = false } = {}) {
  clearTimeout(state.searchTimer);
  if (resetPage) state.page = 1;
  state.abort?.abort();
  const controller = new AbortController();
  state.abort = controller;
  const generation = ++state.generation;
  $("catalog").setAttribute("aria-busy", "true");
  $("load-note").textContent = "Loading from MySQL…";
  const started = performance.now();
  try {
    const query = filterQuery();
    const result = await request(`/api/products?${query}`, { signal: controller.signal });
    if (result.total > MAX_CLIENT_RESULTS) {
      throw new Error("This view exceeds the client-side catalog limit. Narrow your filters.");
    }
    const products = [...result.items];
    while (products.length < result.total) {
      query.set("offset", products.length);
      const batch = await request(`/api/products?${query}`, { signal: controller.signal });
      if (!batch.items.length) break;
      products.push(...batch.items);
    }
    if (generation !== state.generation) return;
    state.products = products;
    $("catalog-error").hidden = true;
    $("load-note").textContent = `Loaded in ${Math.round(performance.now() - started)} ms · MySQL`;
    renderProducts();
  } catch (error) {
    if (error.name === "AbortError" || generation !== state.generation) return;
    $("error-message").textContent = error.message;
    $("catalog-error").hidden = false;
    $("result-summary").textContent = "Could not load catalog";
    $("load-note").textContent = "Database request failed";
    state.products = [];
    $("products-body").replaceChildren();
    $("empty-state").hidden = true;
    $("table-scroll").hidden = true;
    $("previous-page").disabled = true;
    $("next-page").disabled = true;
    $("page-summary").textContent = "No results loaded";
    $("page-number").textContent = "—";
  } finally {
    if (generation === state.generation) $("catalog").setAttribute("aria-busy", "false");
  }
}

async function loadStats() {
  try {
    const stats = await request("/api/stats");
    $("stat-total").textContent = integer.format(stats.total_products);
    $("stat-low").textContent = integer.format(stats.low_stock);
    $("stat-out").textContent = integer.format(stats.out_of_stock);
    $("stat-value").textContent = compactMoney.format(stats.inventory_value);
    $("stat-value").title = money.format(stats.inventory_value);
    $("stat-samples").textContent = `${integer.format(stats.sample_products)} sample records`;
    $("stat-units").textContent = `${integer.format(stats.total_units)} units available`;
  } catch {
    for (const id of ["stat-total", "stat-low", "stat-out", "stat-value"]) $(id).textContent = "—";
    $("stat-samples").textContent = "Database unavailable";
    $("stat-units").textContent = "Database unavailable";
  }
}

function renderProducts() {
  const total = state.products.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const fragment = document.createDocumentFragment();
  for (const product of state.products.slice(start, start + PAGE_SIZE)) {
    const row = element("tr");
    row.dataset.productId = product.id;
    const productCell = element("td");
    const wrap = element("div", "product-cell");
    wrap.append(element("span", "product-tile", product.brand.slice(0, 1)));
    const copy = element("div");
    const name = element("button", "product-link", product.name);
    name.type = "button";
    name.addEventListener("click", () => openDetail(product));
    copy.append(name, element("div", "product-meta", `${product.sku} · ${product.category}`));
    wrap.append(copy);
    productCell.append(wrap);
    row.append(productCell, element("td", "", product.brand), element("td", "numeric", money.format(product.price)));
    const stockCell = element("td");
    const stockClass = product.stock === 0 ? "out" : product.stock <= 5 ? "low" : "in";
    const stockLabel = product.stock === 0 ? "Out of stock" : product.stock <= 5 ? `Low · ${product.stock}` : `In stock · ${product.stock}`;
    const badge = element("span", `stock-tag ${stockClass}`, stockLabel);
    badge.dataset.stock = product.stock;
    stockCell.append(badge);
    const stockButtonCell = element("td");
    const stockButton = element("button", "stock-action", "Adjust stock");
    stockButton.type = "button";
    stockButton.setAttribute("aria-label", `Adjust stock for ${product.name}`);
    stockButton.addEventListener("click", () => withAdmin(() => openStock(product)));
    stockButtonCell.append(stockButton);
    row.append(stockCell, element("td", "numeric", `${Number(product.rating).toFixed(1)} / 5`), stockButtonCell);
    fragment.append(row);
  }
  $("products-body").replaceChildren(fragment);
  $("table-scroll").hidden = total === 0;
  $("empty-state").hidden = total !== 0;
  $("result-summary").textContent = `${integer.format(total)} ${total === 1 ? "result" : "results"} · ${PAGE_SIZE} per page`;
  $("page-summary").textContent = total ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${integer.format(total)}` : "0 products";
  $("page-number").textContent = `Page ${state.page} of ${pages}`;
  $("previous-page").disabled = state.page <= 1;
  $("next-page").disabled = state.page >= pages;
}

function option(value, label) {
  const node = element("option", "", label);
  node.value = value;
  return node;
}

async function loadReferences() {
  const [categories, brands] = await Promise.all([request("/api/categories"), request("/api/brands")]);
  state.categories = categories;
  state.brands = brands;
  for (const category of categories) $("category").append(option(category.id, category.path));
  for (const brand of brands) $("brand").append(option(brand.id, brand.name));
  $("product-brand").replaceChildren(option("", "Choose a brand"), ...brands.map((brand) => option(brand.id, brand.name)));
  $("product-category").replaceChildren(
    option("", "Choose a category"),
    ...categories.filter((category) => category.depth === 3).map((category) => option(category.id, category.path)),
  );
  const tree = document.createDocumentFragment();
  for (const category of categories) {
    const button = element("button", `category-choice depth-${category.depth}`, category.name);
    button.type = "button";
    button.addEventListener("click", () => {
      $("category").value = category.id;
      $("categories-dialog").close();
      loadProducts({ resetPage: true });
      $("catalog").scrollIntoView({ block: "start" });
    });
    tree.append(button);
  }
  $("category-tree").replaceChildren(tree);
}

function clearFilters() {
  $("filters").reset();
  loadProducts({ resetPage: true });
}

function withAdmin(action) {
  if (state.adminKey) action();
  else {
    state.pendingAction = action;
    $("auth-error").textContent = "";
    $("admin-key").value = "";
    $("auth-dialog").showModal();
  }
}

function adminOptions(method, payload) {
  return {
    method,
    headers: { "X-Admin-Key": state.adminKey },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  };
}

async function submitForm(form, errorId, action) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  $(errorId).textContent = "";
  try { await action(); }
  catch (error) { $(errorId).textContent = error.message; }
  finally { button.disabled = false; }
}

function openStock(product) {
  state.stockProduct = { ...product };
  $("stock-product").textContent = `${product.name} · ${product.sku} · Version ${product.version}`;
  $("stock-units").value = product.stock;
  $("stock-reason").value = "Manual adjustment";
  $("stock-error").textContent = "";
  $("stock-dialog").showModal();
}

function openProductForm(product = null) {
  state.editing = product ? { ...product } : null;
  $("product-form").reset();
  $("product-form-title").textContent = product ? "Edit product" : "Add product";
  $("product-save").textContent = product ? "Save changes" : "Create product";
  $("product-sku").readOnly = Boolean(product);
  $("product-stock").disabled = Boolean(product);
  $("product-hint").textContent = product ? "SKU stays unchanged. Use Adjust stock to record stock changes with a reason." : "New products are marked as user-created, not sample records.";
  $("product-error").textContent = "";
  if (product) {
    for (const [id, field] of Object.entries({
      "product-name": "name", "product-sku": "sku", "product-brand": "brand_id",
      "product-category": "category_id", "product-price": "price", "product-stock": "stock",
      "product-rating": "rating", "product-description": "description",
    })) $(id).value = product[field];
  }
  $("product-dialog").showModal();
}

async function openDetail(product) {
  try {
    const current = await request(`/api/products/${product.id}`);
    state.selected = current;
    $("detail-title").textContent = current.name;
    $("detail-sku").textContent = `${current.sku} · ${current.is_sample ? "Sample record" : "User-created record"} · Version ${current.version}`;
    $("detail-description").textContent = current.description || "No description provided.";
    const category = state.categories.find((item) => item.id === current.category_id);
    const fields = {
      Price: money.format(current.price), "Available units": integer.format(current.stock),
      Brand: current.brand, Rating: `${Number(current.rating).toFixed(1)} / 5`,
      Category: category?.path || current.category,
      "Updated (UTC)": `${current.updated_at.replace("T", " ")} UTC`,
    };
    const fragment = document.createDocumentFragment();
    for (const [label, value] of Object.entries(fields)) {
      const group = element("div");
      group.append(element("dt", "", label), element("dd", "", value));
      fragment.append(group);
    }
    $("detail-fields").replaceChildren(fragment);
    $("detail-dialog").showModal();
  } catch (error) { toast(error.message); }
}

function connectEvents() {
  const events = new EventSource("/api/events");
  let connectedOnce = false;
  events.addEventListener("ready", () => {
    $("live-status").classList.add("connected");
    $("live-label").textContent = "Live stock";
    if (connectedOnce) { loadProducts(); loadStats(); }
    connectedOnce = true;
  });
  const changed = (event) => {
    const payload = JSON.parse(event.data);
    if (event.type === "stock") {
      $("event-note").textContent = `Stock updated for product #${payload.product_id} · ${payload.stock_before} → ${payload.stock} units`;
    } else $("event-note").textContent = "Catalog changed. Results refreshed.";
    clearTimeout(state.eventTimer);
    state.eventTimer = setTimeout(() => { loadProducts(); loadStats(); }, 100);
  };
  events.addEventListener("stock", changed);
  events.addEventListener("catalog", changed);
  events.onerror = () => {
    $("live-status").classList.remove("connected");
    $("live-label").textContent = "Reconnecting";
  };
  return events;
}

$("filters").addEventListener("submit", (event) => { event.preventDefault(); loadProducts({ resetPage: true }); });
$("search").addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => loadProducts({ resetPage: true }), 300);
});
for (const id of ["stock", "brand", "rating", "category", "sort"]) {
  $(id).addEventListener("change", () => loadProducts({ resetPage: true }));
}
for (const id of ["min-price", "max-price"]) {
  $(id).addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => loadProducts({ resetPage: true }), 300);
  });
}
for (const id of ["clear-button", "empty-clear", "metric-all"]) $(id).addEventListener("click", clearFilters);
for (const id of ["refresh-button", "retry-button"]) $(id).addEventListener("click", () => { loadProducts(); loadStats(); });
$("metric-low").addEventListener("click", () => { $("stock").value = "low"; loadProducts({ resetPage: true }); });
$("metric-out").addEventListener("click", () => { $("stock").value = "out"; loadProducts({ resetPage: true }); });
$("previous-page").addEventListener("click", () => { state.page--; renderProducts(); });
$("next-page").addEventListener("click", () => { state.page++; renderProducts(); });
$("category-map-button").addEventListener("click", () => $("categories-dialog").showModal());
for (const button of document.querySelectorAll("[data-close]")) {
  button.addEventListener("click", () => $(button.dataset.close).close());
}
$("admin-button").addEventListener("click", () => {
  if (state.adminKey) {
    state.adminKey = "";
    state.pendingAction = null;
    $("admin-button").textContent = "Unlock inventory";
    toast("Inventory locked. Admin key cleared from this tab.");
  } else withAdmin(() => toast("Inventory controls unlocked for this tab."));
});
$("auth-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, "auth-error", async () => {
    const key = $("admin-key").value.trim();
    await request("/api/admin/status", { headers: { "X-Admin-Key": key } });
    state.adminKey = key;
    $("admin-key").value = "";
    $("admin-button").textContent = "Lock inventory";
    $("auth-dialog").close();
    const action = state.pendingAction;
    state.pendingAction = null;
    action?.();
  });
});
$("add-button").addEventListener("click", () => withAdmin(() => openProductForm()));
$("stock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, "stock-error", async () => {
    const product = state.stockProduct;
    await request(`/api/products/${product.id}/stock`, adminOptions("PATCH", {
      stock: Number($("stock-units").value), expected_version: product.version,
      reason: $("stock-reason").value.trim(),
    }));
    $("stock-dialog").close();
    toast("Stock saved. Connected sessions will update automatically.");
    await Promise.all([loadProducts(), loadStats()]);
  });
});
$("product-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, "product-error", async () => {
    const payload = {
      name: $("product-name").value.trim(), description: $("product-description").value.trim(),
      brand_id: Number($("product-brand").value), category_id: Number($("product-category").value),
      price: $("product-price").value, rating: $("product-rating").value,
    };
    if (state.editing) {
      payload.expected_version = state.editing.version;
      await request(`/api/products/${state.editing.id}`, adminOptions("PATCH", payload));
    } else {
      payload.sku = $("product-sku").value.trim();
      payload.stock = Number($("product-stock").value);
      await request("/api/products", adminOptions("POST", payload));
    }
    $("product-dialog").close();
    toast(state.editing ? "Product changes saved." : "Product created.");
    await Promise.all([loadProducts(), loadStats()]);
  });
});
$("detail-stock-button").addEventListener("click", () => {
  $("detail-dialog").close();
  withAdmin(() => openStock(state.selected));
});
$("edit-button").addEventListener("click", () => {
  $("detail-dialog").close();
  withAdmin(() => openProductForm(state.selected));
});
$("archive-button").addEventListener("click", () => {
  $("detail-dialog").close();
  withAdmin(() => {
    $("archive-name").textContent = state.selected.name;
    $("archive-error").textContent = "";
    $("archive-dialog").showModal();
  });
});
$("archive-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(event.currentTarget, "archive-error", async () => {
    await request(`/api/products/${state.selected.id}?expected_version=${state.selected.version}`, adminOptions("DELETE"));
    $("archive-dialog").close();
    toast("Product archived. Event history preserved.");
    await Promise.all([loadProducts(), loadStats()]);
  });
});
$("auth-dialog").addEventListener("close", () => { $("admin-key").value = ""; if (!state.adminKey) state.pendingAction = null; });

async function initialize() {
  await Promise.all([loadProducts(), loadStats(), loadReferences().catch((error) => toast(error.message))]);
}
initialize();
let events = connectEvents();
window.addEventListener("pagehide", () => events.close());
window.addEventListener("pageshow", (event) => { if (event.persisted) { events = connectEvents(); loadProducts(); loadStats(); } });
