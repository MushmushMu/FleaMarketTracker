const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "data.sqlite");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      market_date TEXT,
      budget REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sku (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      source_link TEXT,
      category TEXT,
      sample_status TEXT,
      decision TEXT,
      notes TEXT,
      reorder_point INTEGER NOT NULL DEFAULT 5,
      scale_up_threshold INTEGER NOT NULL DEFAULT 10,
      slow_threshold INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accessory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      sku_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('ORDERED', 'ARRIVED', 'SOLD', 'ADJUST')),
      quantity INTEGER NOT NULL,
      unit_cost REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      event_date TEXT NOT NULL DEFAULT (date('now')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (sku_id) REFERENCES sku(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_name_date ON projects(name, market_date);
  `);

  const accessoryColumns = db.prepare("PRAGMA table_info(accessory)").all();
  if (!accessoryColumns.some((column) => column.name === "category")) {
    db.exec("ALTER TABLE accessory ADD COLUMN category TEXT");
  }

  const skuColumns = db.prepare("PRAGMA table_info(sku)").all();
  if (!skuColumns.some((column) => column.name === "is_archived")) {
    db.exec("ALTER TABLE sku ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0");
  }
}

function summaryByProject(projectId) {
  const sales = db.prepare(`
    SELECT COALESCE(SUM(quantity * unit_price), 0) AS value
    FROM inventory_ledger
    WHERE project_id = ? AND movement_type = 'SOLD'
  `).get(projectId).value;

  const inventoryPurchase = db.prepare(`
    WITH sku_costs AS (
      SELECT
        sku_id,
        SUM(CASE WHEN movement_type = 'ORDERED' THEN quantity * unit_cost ELSE 0 END) AS ordered_cost,
        SUM(CASE WHEN movement_type = 'ARRIVED' THEN quantity * unit_cost ELSE 0 END) AS arrived_cost,
        SUM(CASE WHEN movement_type = 'ARRIVED' THEN quantity ELSE 0 END) AS arrived_qty
      FROM inventory_ledger
      WHERE project_id = ?
      GROUP BY sku_id
    )
    SELECT COALESCE(SUM(
      CASE
        WHEN arrived_qty > 0 THEN arrived_cost
        ELSE ordered_cost
      END
    ), 0) AS value
    FROM sku_costs
  `).get(projectId).value;

  const accessoryCost = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS value
    FROM accessory
    WHERE project_id = ?
  `).get(projectId).value;

  const project = db.prepare(`
    SELECT id, name, market_date, budget, notes
    FROM projects
    WHERE id = ?
  `).get(projectId);

  if (!project) {
    return null;
  }

  const totalCost = inventoryPurchase + accessoryCost;
  const profit = sales - totalCost;
  const budgetRemaining = project.budget - totalCost;

  return {
    ...project,
    sales,
    inventoryPurchase,
    accessoryCost,
    totalCost,
    profit,
    budgetRemaining
  };
}

function enrichSkuRow(row) {
  const soldUnits = row.sold_units;
  const revenue = row.revenue;
  const unitCost = row.unit_cost;
  const avgSoldPrice = soldUnits > 0 ? revenue / soldUnits : null;
  const margin =
    soldUnits > 0 && avgSoldPrice > 0
      ? ((avgSoldPrice - unitCost) / avgSoldPrice) * 100
      : null;

  return {
    ...row,
    avg_sold_price: avgSoldPrice,
    margin
  };
}

function skuStockAndVelocity() {
  const rows = db.prepare(`
    SELECT
      s.id,
      s.code,
      s.name,
      s.source_link,
      s.category,
      s.sample_status,
      s.decision,
      s.notes,
      s.reorder_point,
      s.scale_up_threshold,
      s.slow_threshold,
      s.is_active,
      s.is_archived,
      COALESCE(SUM(CASE
        WHEN l.movement_type = 'ARRIVED' THEN l.quantity
        WHEN l.movement_type = 'ADJUST' THEN l.quantity
        WHEN l.movement_type = 'SOLD' THEN -l.quantity
        ELSE 0
      END), 0) AS current_stock,
      COALESCE(SUM(CASE WHEN l.movement_type = 'SOLD' THEN l.quantity ELSE 0 END), 0) AS sold_units,
      COALESCE(SUM(CASE WHEN l.movement_type = 'ORDERED' THEN l.quantity ELSE 0 END), 0) AS purchased_qty,
      COALESCE(SUM(CASE WHEN l.movement_type = 'ARRIVED' THEN l.quantity ELSE 0 END), 0) AS arrival_qty,
      COALESCE(SUM(CASE WHEN l.movement_type = 'SOLD' THEN l.quantity * l.unit_price ELSE 0 END), 0) AS revenue,
      COALESCE(
        SUM(CASE WHEN l.movement_type IN ('ORDERED', 'ARRIVED') THEN l.quantity * l.unit_cost ELSE 0 END)
        / NULLIF(SUM(CASE WHEN l.movement_type IN ('ORDERED', 'ARRIVED') THEN l.quantity ELSE 0 END), 0),
        0
      ) AS unit_cost,
      COALESCE(SUM(CASE WHEN l.movement_type = 'ORDERED' THEN l.quantity * l.unit_cost ELSE 0 END), 0) AS total_price
    FROM sku s
    LEFT JOIN inventory_ledger l ON l.sku_id = s.id
    GROUP BY s.id
    ORDER BY
      CASE WHEN s.code GLOB 'SKU-[0-9]*' THEN CAST(substr(s.code, 5) AS INTEGER) ELSE 999999 END,
      s.code ASC
  `).all();

  return rows.map(enrichSkuRow);
}

function computeAlerts() {
  const skus = skuStockAndVelocity();
  const alerts = [];

  for (const item of skus) {
    if (!item.is_active || item.is_archived) {
      continue;
    }

    if (item.current_stock <= item.reorder_point) {
      alerts.push({
        type: "LOW_STOCK",
        skuCode: item.code,
        skuName: item.name,
        message: `${item.name} is low stock (${item.current_stock} left).`
      });
    }

    if (item.sold_units >= item.scale_up_threshold) {
      alerts.push({
        type: "SCALE_UP",
        skuCode: item.code,
        skuName: item.name,
        message: `${item.name} is selling well (${item.sold_units} sold). Consider scaling up.`
      });
    }

    if (item.sold_units <= item.slow_threshold) {
      alerts.push({
        type: "SLOW_ITEM",
        skuCode: item.code,
        skuName: item.name,
        message: `${item.name} is a slow item (${item.sold_units} sold). Review for kill list.`
      });
    }

    if (typeof item.decision === "string" && item.decision.toLowerCase() === "scale") {
      alerts.push({
        type: "SCALE_UP_DECISION",
        skuCode: item.code,
        skuName: item.name,
        message: `${item.name} is marked "Scale" in your SKU decision column.`
      });
    }
  }

  return alerts;
}

function getSkuProjectId(skuId) {
  const row = db.prepare(`
    SELECT project_id
    FROM inventory_ledger
    WHERE sku_id = ? AND project_id IS NOT NULL
    ORDER BY id DESC
    LIMIT 1
  `).get(skuId);
  return row ? row.project_id : null;
}

function updateSkuInventoryRow(skuId, updates) {
  const existing = db.prepare("SELECT id FROM sku WHERE id = ?").get(skuId);
  if (!existing) {
    return null;
  }

  const {
    name,
    sample_status,
    decision,
    unit_cost = 0,
    arrival_qty = 0,
    purchased_qty = 0,
    sold_units = 0,
    avg_sold_price = 0
  } = updates;

  const parsedUnitCost = Number(unit_cost) || 0;
  const parsedArrivalQty = Math.max(0, Math.floor(Number(arrival_qty) || 0));
  const parsedPurchasedQty = Math.max(0, Math.floor(Number(purchased_qty) || 0));
  const parsedSoldUnits = Math.max(0, Math.floor(Number(sold_units) || 0));
  const parsedAvgSoldPrice = Number(avg_sold_price) || 0;

  const updateSku = db.prepare(`
    UPDATE sku
    SET name = ?, sample_status = ?, decision = ?
    WHERE id = ?
  `);

  const deleteMovements = db.prepare(`
    DELETE FROM inventory_ledger
    WHERE sku_id = ? AND movement_type IN ('ORDERED', 'ARRIVED', 'SOLD')
  `);

  const insertMovement = db.prepare(`
    INSERT INTO inventory_ledger(
      project_id, sku_id, movement_type, quantity, unit_cost, unit_price, notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const projectId = getSkuProjectId(skuId);
  const sync = db.transaction(() => {
    updateSku.run(
      String(name).trim(),
      sample_status || null,
      decision || null,
      skuId
    );

    deleteMovements.run(skuId);

    if (parsedPurchasedQty > 0) {
      insertMovement.run(
        projectId,
        skuId,
        "ORDERED",
        parsedPurchasedQty,
        parsedUnitCost,
        0,
        "Updated from dashboard"
      );
    }
    if (parsedArrivalQty > 0) {
      insertMovement.run(
        projectId,
        skuId,
        "ARRIVED",
        parsedArrivalQty,
        parsedUnitCost,
        0,
        "Updated from dashboard"
      );
    }
    if (parsedSoldUnits > 0) {
      insertMovement.run(
        projectId,
        skuId,
        "SOLD",
        parsedSoldUnits,
        parsedUnitCost,
        parsedAvgSoldPrice,
        "Updated from dashboard"
      );
    }
  });

  sync();
  return enrichSkuRow(
    skuStockAndVelocity().find((row) => row.id === skuId)
  );
}

function getDefaultProjectId() {
  const latest = db.prepare("SELECT id FROM projects ORDER BY id DESC LIMIT 1").get();
  if (latest) {
    return latest.id;
  }

  const result = db.prepare(`
    INSERT INTO projects(name, market_date, budget, notes)
    VALUES ('Default Market', date('now'), 0, 'Auto-created for accessory costs')
  `).run();
  return result.lastInsertRowid;
}

function getNextSkuCode() {
  const rows = db.prepare("SELECT code FROM sku WHERE code GLOB 'SKU-[0-9]*'").all();
  const maxNumber = rows.reduce((max, row) => {
    const match = String(row.code).match(/^SKU-(\d+)$/i);
    if (!match) {
      return max;
    }
    return Math.max(max, Number(match[1]));
  }, 0);
  return `SKU-${String(maxNumber + 1).padStart(3, "0")}`;
}

function deleteSku(skuId) {
  const existing = db.prepare("SELECT id FROM sku WHERE id = ?").get(skuId);
  if (!existing) {
    return false;
  }
  db.prepare("DELETE FROM sku WHERE id = ?").run(skuId);
  return true;
}

function archiveSku(skuId) {
  const existing = db.prepare("SELECT id FROM sku WHERE id = ?").get(skuId);
  if (!existing) {
    return false;
  }
  db.prepare("UPDATE sku SET is_archived = 1 WHERE id = ?").run(skuId);
  return true;
}

function getDashboardTotals() {
  const skus = skuStockAndVelocity();
  const activeSkus = skus.filter((item) => !item.is_archived);

  const inventoryCost = activeSkus.reduce(
    (sum, item) => sum + Number(item.total_price || 0),
    0
  );
  const inventoryRevenue = skus.reduce(
    (sum, item) => sum + Number(item.revenue || 0),
    0
  );

  const accessoryCost = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS value FROM accessory
  `).get().value;

  const totalCost = inventoryCost + accessoryCost;

  return {
    inventoryCost,
    inventoryRevenue,
    accessoryCost,
    totalCost,
    currentEarning: inventoryRevenue,
    profit: inventoryRevenue - totalCost
  };
}

const VALID_ACCESSORY_CATEGORIES = new Set(["exhibition", "application"]);

function normalizeAccessoryCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();
  if (!VALID_ACCESSORY_CATEGORIES.has(normalized)) {
    throw new Error('Category must be "exhibition" or "application".');
  }
  return normalized;
}

function listAccessories() {
  return db.prepare(`
    SELECT
      a.id,
      a.project_id,
      a.description,
      a.category,
      a.amount,
      a.created_at,
      p.name AS project_name
    FROM accessory a
    LEFT JOIN projects p ON p.id = a.project_id
    ORDER BY a.id DESC
  `).all();
}

function createAccessory({ description, category, amount, project_id }) {
  const projectId = project_id || getDefaultProjectId();
  const normalizedCategory = normalizeAccessoryCategory(category);
  const result = db.prepare(`
    INSERT INTO accessory(project_id, description, category, amount)
    VALUES (?, ?, ?, ?)
  `).run(
    projectId,
    String(description).trim(),
    normalizedCategory,
    Number(amount) || 0
  );
  return db.prepare(`
    SELECT
      a.id,
      a.project_id,
      a.description,
      a.category,
      a.amount,
      a.created_at,
      p.name AS project_name
    FROM accessory a
    LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.id = ?
  `).get(result.lastInsertRowid);
}

function updateAccessory(accessoryId, { description, category, amount }) {
  const existing = db.prepare("SELECT id FROM accessory WHERE id = ?").get(accessoryId);
  if (!existing) {
    return null;
  }

  const normalizedCategory = normalizeAccessoryCategory(category);

  db.prepare(`
    UPDATE accessory
    SET description = ?, category = ?, amount = ?
    WHERE id = ?
  `).run(
    String(description).trim(),
    normalizedCategory,
    Number(amount) || 0,
    accessoryId
  );

  return db.prepare(`
    SELECT
      a.id,
      a.project_id,
      a.description,
      a.category,
      a.amount,
      a.created_at,
      p.name AS project_name
    FROM accessory a
    LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.id = ?
  `).get(accessoryId);
}

function deleteAccessory(accessoryId) {
  const existing = db.prepare("SELECT id FROM accessory WHERE id = ?").get(accessoryId);
  if (!existing) {
    return false;
  }
  db.prepare("DELETE FROM accessory WHERE id = ?").run(accessoryId);
  return true;
}

module.exports = {
  db,
  initDb,
  summaryByProject,
  skuStockAndVelocity,
  computeAlerts,
  updateSkuInventoryRow,
  getDefaultProjectId,
  getNextSkuCode,
  deleteSku,
  archiveSku,
  getDashboardTotals,
  listAccessories,
  createAccessory,
  updateAccessory,
  deleteAccessory
};
