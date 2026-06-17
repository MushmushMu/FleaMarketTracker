const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const {
  db,
  initDb,
  summaryByProject,
  skuStockAndVelocity,
  computeAlerts,
  updateSkuInventoryRow,
  getNextSkuCode,
  deleteSku,
  archiveSku,
  getDashboardTotals,
  listAccessories,
  createAccessory,
  updateAccessory,
  deleteAccessory
} = require("./db");

initDb();

if (process.argv.includes("--init-only")) {
  console.log("Database initialized.");
  process.exit(0);
}

const app = express();
const port = process.env.PORT || 3000;
const VALID_MOVEMENT_TYPES = new Set(["ORDERED", "ARRIVED", "SOLD", "ADJUST"]);

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function parseOptionalNumber(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return parsed;
}

function parseRequiredInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${fieldName} is required.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer.`);
  }

  return parsed;
}

app.get("/api/projects", (_req, res) => {
  const rows = db.prepare("SELECT * FROM projects ORDER BY market_date DESC, id DESC").all();
  res.json(rows);
});

app.post("/api/projects", (req, res) => {
  const { name, market_date, budget, notes } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Project name is required." });
  }

  try {
    const result = db.prepare(`
      INSERT INTO projects(name, market_date, budget, notes)
      VALUES (?, ?, ?, ?)
    `).run(name, market_date || null, Number(budget || 0), notes || null);
    const created = db.prepare("SELECT * FROM projects WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/projects/:id/summary", (req, res) => {
  const projectId = Number(req.params.id);
  const summary = summaryByProject(projectId);
  if (!summary) {
    return res.status(404).json({ error: "Project not found." });
  }
  res.json(summary);
});

app.get("/api/sku", (_req, res) => {
  const rows = db.prepare("SELECT * FROM sku ORDER BY name ASC").all();
  res.json(rows);
});

app.get("/api/sku/next-code", (_req, res) => {
  res.json({ code: getNextSkuCode() });
});

app.post("/api/sku", (req, res) => {
  const {
    code,
    name,
    source_link,
    category,
    sample_status,
    decision,
    notes,
    reorder_point = 5,
    scale_up_threshold = 10,
    slow_threshold = 1
  } = req.body;

  if (!code || !name) {
    return res.status(400).json({ error: "SKU code and name are required." });
  }

  try {
    const result = db.prepare(`
      INSERT INTO sku(
        code, name, source_link, category, sample_status, decision, notes,
        reorder_point, scale_up_threshold, slow_threshold
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code,
      name,
      source_link || null,
      category || null,
      sample_status || null,
      decision || null,
      notes || null,
      Number(reorder_point),
      Number(scale_up_threshold),
      Number(slow_threshold)
    );
    const created = db.prepare("SELECT * FROM sku WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/sku/:id", (req, res) => {
  const skuId = Number(req.params.id);
  if (!Number.isInteger(skuId)) {
    return res.status(400).json({ error: "SKU id must be an integer." });
  }

  try {
    const removed = deleteSku(skuId);
    if (!removed) {
      return res.status(404).json({ error: "SKU not found." });
    }
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/sku/:id/archive", (req, res) => {
  const skuId = Number(req.params.id);
  if (!Number.isInteger(skuId)) {
    return res.status(400).json({ error: "SKU id must be an integer." });
  }

  try {
    const archived = archiveSku(skuId);
    if (!archived) {
      return res.status(404).json({ error: "SKU not found." });
    }
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/dashboard/totals", (_req, res) => {
  res.json(getDashboardTotals());
});

app.get("/api/accessory", (_req, res) => {
  res.json(listAccessories());
});

app.post("/api/accessory", (req, res) => {
  const { project_id, description, category, amount } = req.body;
  if (!description) {
    return res.status(400).json({ error: "Name is required." });
  }
  if (!category) {
    return res.status(400).json({ error: "Category is required." });
  }

  try {
    const created = createAccessory({ project_id, description, category, amount });
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/accessory/:id", (req, res) => {
  const accessoryId = Number(req.params.id);
  if (!Number.isInteger(accessoryId)) {
    return res.status(400).json({ error: "Accessory id must be an integer." });
  }

  const { description, category, amount } = req.body;
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: "Name is required." });
  }
  if (!category) {
    return res.status(400).json({ error: "Category is required." });
  }

  try {
    const updated = updateAccessory(accessoryId, { description, category, amount });
    if (!updated) {
      return res.status(404).json({ error: "Accessory not found." });
    }
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/accessory/:id", (req, res) => {
  const accessoryId = Number(req.params.id);
  if (!Number.isInteger(accessoryId)) {
    return res.status(400).json({ error: "Accessory id must be an integer." });
  }

  try {
    const removed = deleteAccessory(accessoryId);
    if (!removed) {
      return res.status(404).json({ error: "Accessory not found." });
    }
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/inventory/movement", (req, res) => {
  const {
    project_id = null,
    sku_id,
    movement_type,
    quantity,
    unit_cost = 0,
    unit_price = 0,
    event_date,
    notes
  } = req.body;

  if (sku_id === undefined || sku_id === null || sku_id === "") {
    return res.status(400).json({ error: "sku_id is required." });
  }

  if (!VALID_MOVEMENT_TYPES.has(movement_type)) {
    return res.status(400).json({
      error: "movement_type must be one of ORDERED, ARRIVED, SOLD, or ADJUST."
    });
  }

  try {
    const parsedSkuId = parseRequiredInteger(sku_id, "sku_id");
    const parsedQuantity = parseRequiredInteger(quantity, "quantity");
    const parsedProjectId =
      project_id === undefined || project_id === null || project_id === ""
        ? null
        : parseRequiredInteger(project_id, "project_id");
    const parsedUnitCost = parseOptionalNumber(unit_cost, "unit_cost");
    const parsedUnitPrice = parseOptionalNumber(unit_price, "unit_price");

    if (movement_type === "ADJUST") {
      if (parsedQuantity === 0) {
        return res.status(400).json({ error: "ADJUST quantity cannot be 0." });
      }
    } else if (parsedQuantity <= 0) {
      return res.status(400).json({ error: "quantity must be greater than 0." });
    }

    const result = db.prepare(`
      INSERT INTO inventory_ledger(
        project_id, sku_id, movement_type, quantity, unit_cost, unit_price, event_date, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsedProjectId,
      parsedSkuId,
      movement_type,
      parsedQuantity,
      parsedUnitCost,
      parsedUnitPrice,
      event_date || new Date().toISOString().slice(0, 10),
      notes || null
    );
    const created = db.prepare("SELECT * FROM inventory_ledger WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/import/excel", (req, res) => {
  const { filePath = "Flea_Market_Project_Tracker_V2 (1).xlsx", replace = false } = req.body || {};
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, "..", filePath);

  const result = spawnSync(
    "python",
    [path.join(__dirname, "import_excel.py"), "--file", fullPath, ...(replace ? ["--replace"] : [])],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    return res.status(400).json({
      error: "Excel import failed",
      details: result.stderr || result.stdout
    });
  }

  try {
    res.json(JSON.parse(result.stdout.trim()));
  } catch {
    res.json({ ok: true, output: result.stdout.trim() });
  }
});

app.get("/api/inventory/stock", (_req, res) => {
  res.json(skuStockAndVelocity());
});

app.patch("/api/inventory/sku/:id", (req, res) => {
  const skuId = Number(req.params.id);
  if (!Number.isInteger(skuId)) {
    return res.status(400).json({ error: "SKU id must be an integer." });
  }

  const { name, sample_status, decision, unit_cost, arrival_qty, purchased_qty, sold_units, avg_sold_price } =
    req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: "Product name is required." });
  }

  try {
    const updated = updateSkuInventoryRow(skuId, {
      name,
      sample_status,
      decision,
      unit_cost,
      arrival_qty,
      purchased_qty,
      sold_units,
      avg_sold_price
    });

    if (!updated) {
      return res.status(404).json({ error: "SKU not found." });
    }

    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/export/excel", (_req, res) => {
  const outputPath = path.join(os.tmpdir(), `flea-market-export-${Date.now()}.xlsx`);
  const result = spawnSync(
    "python",
    [path.join(__dirname, "export_excel.py"), "--output", outputPath],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    return res.status(400).json({
      error: "Excel export failed",
      details: result.stderr || result.stdout
    });
  }

  if (!fs.existsSync(outputPath)) {
    return res.status(500).json({ error: "Export file was not created." });
  }

  res.download(outputPath, "Flea_Market_Export.xlsx", (error) => {
    fs.unlink(outputPath, () => {});
    if (error) {
      console.error(error);
    }
  });
});

app.get("/api/alerts", (_req, res) => {
  res.json(computeAlerts());
});

app.listen(port, () => {
  console.log(`Flea market tracker running at http://localhost:${port}`);
});
