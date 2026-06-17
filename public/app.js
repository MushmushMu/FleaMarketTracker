async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function patchJson(url, body) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function deleteRequest(url) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    let message = "Request failed";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // ignore non-json error bodies
    }
    throw new Error(message);
  }
}

async function postNoContent(url) {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    let message = "Request failed";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // ignore non-json error bodies
    }
    throw new Error(message);
  }
}

function formToObject(form) {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function pretty(el, data) {
  el.textContent = JSON.stringify(data, null, 2);
}

let inventoryItems = [];
let accessoryItems = [];
let dashboardTotals = null;

const ACCESSORY_CATEGORIES = [
  { value: "exhibition", label: "Exhibition" },
  { value: "application", label: "Application" }
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SKU_CODE_PATTERN = /^SKU-\d+$/i;

function inventorySearchText(item) {
  return [item.code, item.name, item.decision, item.sample_status]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return `${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`;
}

function normalizeSampleStatus(status) {
  if (!status) {
    return "";
  }
  const normalized = status.toLowerCase();
  if (normalized === "pass") {
    return "pass";
  }
  if (normalized === "fail") {
    return "fail";
  }
  if (normalized.includes("progress")) {
    return "in_progress";
  }
  return normalized;
}

function getInventoryFilterState() {
  return {
    search: document.getElementById("inventorySearch").value.trim().toLowerCase(),
    sampleEval: document.getElementById("filterSampleEval").value,
    decision: document.getElementById("filterDecision").value,
    stock: document.getElementById("filterStock").value
  };
}

function matchesStockFilter(item, stockFilter) {
  switch (stockFilter) {
    case "low_stock":
      return item.current_stock > 0 && item.current_stock <= item.reorder_point;
    case "out_of_stock":
      return item.current_stock <= 0;
    case "in_stock":
      return item.current_stock > 0;
    case "has_sales":
      return item.sold_units > 0;
    case "no_sales":
      return item.sold_units === 0;
    default:
      return true;
  }
}

function getActiveInventoryItems(items) {
  return items.filter((item) => SKU_CODE_PATTERN.test(item.code) && !item.is_archived);
}

function applyInventoryFilters(items) {
  const { search, sampleEval, decision, stock } = getInventoryFilterState();
  let result = getActiveInventoryItems(items);

  if (search) {
    result = result.filter((item) => inventorySearchText(item).includes(search));
  }
  if (sampleEval !== "all") {
    result = result.filter(
      (item) => normalizeSampleStatus(item.sample_status) === sampleEval
    );
  }
  if (decision !== "all") {
    result = result.filter(
      (item) => (item.decision || "").toLowerCase() === decision
    );
  }
  if (stock !== "all") {
    result = result.filter((item) => matchesStockFilter(item, stock));
  }

  return result;
}

function hasActiveInventoryFilters() {
  const { search, sampleEval, decision, stock } = getInventoryFilterState();
  return Boolean(search) || sampleEval !== "all" || decision !== "all" || stock !== "all";
}

function refreshInventoryView() {
  renderInventoryTable(inventoryItems);
  renderOverviewGrid(inventoryItems);
  renderProjectSummary();
}

function renderProjectSummary() {
  if (!dashboardTotals) {
    return;
  }

  document.getElementById("totalProjectCost").textContent = formatMoney(dashboardTotals.totalCost);
  document.getElementById("currentEarning").textContent = formatMoney(dashboardTotals.currentEarning);
  document.getElementById("summaryInventoryCost").textContent = formatMoney(dashboardTotals.inventoryCost);
  document.getElementById("summaryAccessoryCost").textContent = formatMoney(dashboardTotals.accessoryCost);
}

function overviewSearchText(item) {
  return [item.name, item.code].filter(Boolean).join(" ").toLowerCase();
}

function getOverviewItems(items) {
  const search = document.getElementById("overviewSearch").value.trim().toLowerCase();
  let result = getActiveInventoryItems(items);

  if (search) {
    result = result.filter((item) => overviewSearchText(item).includes(search));
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function renderOverviewGrid(items) {
  const grid = document.getElementById("overviewGrid");
  const countEl = document.getElementById("overviewCount");
  const filtered = getOverviewItems(items);

  if (filtered.length === 0) {
    grid.innerHTML = `<p class="empty-overview">No products to display.</p>`;
    countEl.textContent = items.length ? "Showing 0 products" : "No inventory data yet.";
    return;
  }

  grid.innerHTML = filtered
    .map((item) => {
      const lowStock = item.current_stock <= item.reorder_point;
      return `
        <article class="overview-card ${lowStock ? "overview-card-low" : ""}">
          <h3 class="overview-name">${escapeHtml(item.name)}</h3>
          <p class="overview-qty ${lowStock ? "stock-low" : ""}">
            <span class="overview-qty-label">Current Quantity</span>
            <span class="overview-qty-value">${item.current_stock}</span>
          </p>
        </article>
      `;
    })
    .join("");

  countEl.textContent = `Showing ${filtered.length} product${filtered.length === 1 ? "" : "s"}`;
}

function editableSelect(field, value, options) {
  const normalizedValue = (value || "").toLowerCase();
  const optionsHtml = options
    .map((option) => {
      const selected =
        normalizedValue === option.value.toLowerCase() ||
        (option.value === "In progress" && normalizedValue.includes("progress"))
          ? "selected"
          : "";
      return `<option value="${option.value}" ${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join("");

  return `<select class="cell-input" data-field="${field}">${optionsHtml}</select>`;
}

function editableInput(field, value, type = "text", extraClass = "") {
  const displayValue = value === null || value === undefined ? "" : value;
  return `<input class="cell-input ${extraClass}" data-field="${field}" type="${type}" value="${escapeHtml(displayValue)}" />`;
}

function readRowValues(row) {
  const values = {};
  row.querySelectorAll("[data-field]").forEach((input) => {
    values[input.dataset.field] = input.value;
  });
  return values;
}

async function saveInventoryRow(button) {
  const row = button.closest("tr");
  const skuId = row.dataset.skuId;
  const values = readRowValues(row);

  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const updated = await patchJson(`/api/inventory/sku/${skuId}`, {
      name: values.name,
      sample_status: values.sample_status || null,
      decision: values.decision || null,
      unit_cost: values.unit_cost,
      arrival_qty: values.arrival_qty,
      purchased_qty: values.purchased_qty,
      sold_units: values.sold_units,
      avg_sold_price: values.avg_sold_price
    });

    const index = inventoryItems.findIndex((item) => String(item.id) === String(skuId));
    if (index >= 0) {
      inventoryItems[index] = updated;
    }
    await loadDashboardTotals();
    refreshInventoryView();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
    button.textContent = "Save";
  }
}

async function deleteInventoryRow(button) {
  const row = button.closest("tr");
  const skuId = row.dataset.skuId;
  const code = row.querySelector("code")?.textContent || "this SKU";

  if (!window.confirm(`Delete ${code}? This cannot be undone.`)) {
    return;
  }

  button.disabled = true;
  button.textContent = "Deleting...";

  try {
    await deleteRequest(`/api/sku/${skuId}`);
    inventoryItems = inventoryItems.filter((item) => String(item.id) !== String(skuId));
    await loadDashboardTotals();
    refreshInventoryView();
    await prefetchNextSkuCode();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
    button.textContent = "Delete";
  }
}

async function archiveInventoryRow(button) {
  const row = button.closest("tr");
  const skuId = row.dataset.skuId;
  const code = row.querySelector("code")?.textContent || "this SKU";

  if (!window.confirm(`Archive ${code}? It will be hidden from the interactive dashboard.`)) {
    return;
  }

  button.disabled = true;
  button.textContent = "Archiving...";

  try {
    await postNoContent(`/api/sku/${skuId}/archive`);
    inventoryItems = inventoryItems.filter((item) => String(item.id) !== String(skuId));
    await loadDashboardTotals();
    refreshInventoryView();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
    button.textContent = "Archive";
  }
}

function renderInventoryTable(items) {
  const tbody = document.getElementById("inventoryTableBody");
  const countEl = document.getElementById("inventoryCount");
  const totalEl = document.getElementById("inventoryTotal");
  const skuItems = getActiveInventoryItems(items);
  const filtered = applyInventoryFilters(items);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="empty-row">No inventory items found.</td></tr>`;
    countEl.textContent = skuItems.length
      ? `Showing 0 of ${skuItems.length} SKUs`
      : "No inventory data yet.";
    totalEl.textContent = skuItems.length
      ? `Total inventory cost: ${formatMoney(0)}`
      : "";
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      const lowStock = item.current_stock <= item.reorder_point;
      const stockClass = lowStock ? "stock-low" : "";

      return `
        <tr class="${lowStock ? "row-low-stock" : ""}" data-sku-id="${item.id}">
          <td><code>${escapeHtml(item.code)}</code></td>
          <td class="product-name">${editableInput("name", item.name)}</td>
          <td class="num">${editableInput("unit_cost", item.unit_cost, "number", "num-input")}</td>
          <td class="num">${editableInput("arrival_qty", item.arrival_qty, "number", "num-input")}</td>
          <td class="num">${editableInput("purchased_qty", item.purchased_qty, "number", "num-input")}</td>
          <td class="num">${formatMoney(item.total_price)}</td>
          <td>${editableSelect("sample_status", item.sample_status, [
            { value: "", label: "—" },
            { value: "Pass", label: "Pass" },
            { value: "Fail", label: "Fail" },
            { value: "In progress", label: "In progress" }
          ])}</td>
          <td>${editableSelect("decision", item.decision, [
            { value: "", label: "—" },
            { value: "Scale", label: "Scale" },
            { value: "Kill", label: "Kill" },
            { value: "Sample", label: "Sample" }
          ])}</td>
          <td class="num">${editableInput("sold_units", item.sold_units, "number", "num-input")}</td>
          <td class="num ${stockClass}">${item.current_stock}</td>
          <td class="num">${formatMoney(item.revenue)}</td>
          <td class="num">${editableInput("avg_sold_price", item.avg_sold_price, "number", "num-input")}</td>
          <td class="num">${formatPercent(item.margin)}</td>
          <td class="actions-cell">
            <button type="button" class="btn-save" data-action="save-row">Save</button>
            <button type="button" class="btn-archive" data-action="archive-row">Archive</button>
            <button type="button" class="btn-delete" data-action="delete-row">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");

  countEl.textContent =
    filtered.length === skuItems.length && !hasActiveInventoryFilters()
      ? `Showing ${skuItems.length} SKU${skuItems.length === 1 ? "" : "s"}`
      : `Showing ${filtered.length} of ${skuItems.length} SKUs`;

  const inventoryCost = skuItems.reduce(
    (sum, item) => sum + Number(item.total_price || 0),
    0
  );
  totalEl.textContent = `Total inventory cost: ${formatMoney(inventoryCost)}`;
}

function accessorySearchText(item) {
  return [item.category, item.description].filter(Boolean).join(" ").toLowerCase();
}

function getFilteredAccessories(items) {
  const search = document.getElementById("accessorySearch").value.trim().toLowerCase();
  if (!search) {
    return items;
  }
  return items.filter((item) => accessorySearchText(item).includes(search));
}

function accessoryCategorySelect(field, value) {
  return editableSelect(field, value, [
    { value: "", label: "—" },
    ...ACCESSORY_CATEGORIES
  ]);
}

function renderAccessoryTable(items) {
  const tbody = document.getElementById("accessoryTableBody");
  const countEl = document.getElementById("accessoryCount");
  const totalEl = document.getElementById("accessoryTotal");
  const filtered = getFilteredAccessories(items);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No accessories found.</td></tr>`;
    countEl.textContent = items.length ? "Showing 0 accessories" : "No accessory data yet.";
    totalEl.textContent = items.length
      ? `Total accessory cost: ${formatMoney(0)}`
      : "";
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => `
      <tr data-accessory-id="${item.id}">
        <td>${editableInput("description", item.description)}</td>
        <td>${accessoryCategorySelect("category", item.category)}</td>
        <td class="num">${editableInput("amount", item.amount, "number", "num-input")}</td>
        <td class="actions-cell">
          <button type="button" class="btn-save" data-action="save-accessory">Save</button>
          <button type="button" class="btn-delete" data-action="delete-accessory">Delete</button>
        </td>
      </tr>
    `)
    .join("");

  const filteredCost = filtered.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalCost = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  countEl.textContent = `Showing ${filtered.length} of ${items.length} accessories`;
  totalEl.textContent =
    filtered.length === items.length
      ? `Total accessory cost: ${formatMoney(totalCost)}`
      : `Filtered accessory cost: ${formatMoney(filteredCost)} | Total accessory cost: ${formatMoney(totalCost)}`;
}

function clearInventoryFilters() {
  document.getElementById("inventorySearch").value = "";
  document.getElementById("filterSampleEval").value = "all";
  document.getElementById("filterDecision").value = "all";
  document.getElementById("filterStock").value = "all";
  refreshInventoryView();
}

async function loadDashboardTotals() {
  const res = await fetch("/api/dashboard/totals");
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to load dashboard totals");
  }

  dashboardTotals = data;
  renderProjectSummary();
}

async function loadInventory() {
  const res = await fetch("/api/inventory/stock");
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to load inventory");
  }

  inventoryItems = data;
  await loadDashboardTotals();
  refreshInventoryView();
}

async function loadAccessories() {
  const res = await fetch("/api/accessory");
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to load accessories");
  }

  accessoryItems = data;
  renderAccessoryTable(accessoryItems);
}

async function prefetchNextSkuCode() {
  const res = await fetch("/api/sku/next-code");
  const data = await res.json();
  if (res.ok) {
    document.getElementById("addSkuCode").value = data.code;
  }
}

async function saveAccessoryRow(button) {
  const row = button.closest("tr");
  const accessoryId = row.dataset.accessoryId;
  const values = readRowValues(row);

  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const updated = await patchJson(`/api/accessory/${accessoryId}`, {
      category: values.category,
      description: values.description,
      amount: values.amount
    });

    const index = accessoryItems.findIndex((item) => String(item.id) === String(accessoryId));
    if (index >= 0) {
      accessoryItems[index] = updated;
    }
    renderAccessoryTable(accessoryItems);
    await loadDashboardTotals();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
    button.textContent = "Save";
  }
}

async function deleteAccessoryRow(button) {
  const row = button.closest("tr");
  const accessoryId = row.dataset.accessoryId;

  if (!window.confirm("Delete this accessory?")) {
    return;
  }

  button.disabled = true;
  button.textContent = "Deleting...";

  try {
    await deleteRequest(`/api/accessory/${accessoryId}`);
    accessoryItems = accessoryItems.filter((item) => String(item.id) !== String(accessoryId));
    renderAccessoryTable(accessoryItems);
    await loadDashboardTotals();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
    button.textContent = "Delete";
  }
}

async function exportToExcel() {
  const button = document.getElementById("exportExcel");
  button.disabled = true;
  button.textContent = "Exporting...";

  try {
    const res = await fetch("/api/export/excel");
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Export failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Flea_Market_Export.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
    button.textContent = "Export to Excel";
  }
}

document.getElementById("addSkuForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = formToObject(e.target);

  try {
    await postJson("/api/sku", body);
    e.target.reset();
    await loadInventory();
    await prefetchNextSkuCode();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("addAccessoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = formToObject(e.target);

  try {
    await postJson("/api/accessory", body);
    e.target.reset();
    await loadAccessories();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("refreshStock").addEventListener("click", async () => {
  try {
    await loadInventory();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("exportExcel").addEventListener("click", exportToExcel);

document.getElementById("inventorySearch").addEventListener("input", refreshInventoryView);

["filterSampleEval", "filterDecision", "filterStock"].forEach((id) => {
  document.getElementById(id).addEventListener("change", refreshInventoryView);
});

document.getElementById("clearInventoryFilters").addEventListener("click", clearInventoryFilters);

document.getElementById("inventoryTableBody").addEventListener("click", (event) => {
  const saveButton = event.target.closest('[data-action="save-row"]');
  if (saveButton) {
    saveInventoryRow(saveButton);
    return;
  }

  const archiveButton = event.target.closest('[data-action="archive-row"]');
  if (archiveButton) {
    archiveInventoryRow(archiveButton);
    return;
  }

  const deleteButton = event.target.closest('[data-action="delete-row"]');
  if (deleteButton) {
    deleteInventoryRow(deleteButton);
  }
});

document.getElementById("accessoryTableBody").addEventListener("click", (event) => {
  const saveButton = event.target.closest('[data-action="save-accessory"]');
  if (saveButton) {
    saveAccessoryRow(saveButton);
    return;
  }

  const deleteButton = event.target.closest('[data-action="delete-accessory"]');
  if (deleteButton) {
    deleteAccessoryRow(deleteButton);
  }
});

document.getElementById("accessorySearch").addEventListener("input", () => {
  renderAccessoryTable(accessoryItems);
});

document.getElementById("refreshAccessories").addEventListener("click", async () => {
  try {
    await loadAccessories();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("overviewSearch").addEventListener("input", () => {
  renderOverviewGrid(inventoryItems);
});

document.getElementById("refreshOverview").addEventListener("click", async () => {
  try {
    await loadInventory();
  } catch (err) {
    alert(err.message);
  }
});

Promise.all([loadInventory(), loadAccessories(), loadDashboardTotals(), prefetchNextSkuCode()]).catch((err) => {
  document.getElementById("inventoryTableBody").innerHTML =
    `<tr><td colspan="14" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
  document.getElementById("overviewGrid").innerHTML =
    `<p class="empty-overview">${escapeHtml(err.message)}</p>`;
  document.getElementById("accessoryTableBody").innerHTML =
    `<tr><td colspan="4" class="empty-row">${escapeHtml(err.message)}</td></tr>`;
});

document.getElementById("refreshAlerts").addEventListener("click", async () => {
  const res = await fetch("/api/alerts");
  const data = await res.json();
  pretty(document.getElementById("alertsOutput"), data);
});
