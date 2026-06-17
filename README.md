# Flea Market Tracker

A web dashboard to manage flea market inventory, accessory costs, earnings, and alerts.

Data is stored locally in `data.sqlite` in the project folder.

## Quick Start

1. Install dependencies (first time only):

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm run dev
   ```

3. Open the dashboard:

   [http://localhost:3000](http://localhost:3000)

The dev server auto-restarts when you change server code. Refresh the browser after frontend changes.

---

## Dashboard Usage

### Project Summary (top panel)

Shows project-wide totals:

| Field | Meaning |
|-------|---------|
| **Total Project Cost** | Inventory cost + accessory cost |
| **Current Earning** | Total sales revenue from all SKUs |
| **Inventory Cost** | Purchase cost of active (non-archived) inventory |
| **Accessory Cost** | Sum of all accessory expenses |

These update automatically when you save, add, delete, or archive items.

---

### High-Level Dashboard

A quick read-only view of **product name** and **current quantity** (stock on hand).

- Use **Search products** to filter by name or SKU code
- **Refresh** reloads data from the database
- Low-stock items are highlighted in amber
- Archived SKUs are hidden here

---

### Interactive Dashboard

The main workspace for managing SKUs.

#### Add a SKU

1. Enter a **SKU code** (auto-suggested, e.g. `SKU-032`) and **Product name**
2. Click **Add SKU**
3. New rows appear with default empty values — fill in details and click **Save**

#### Edit a SKU

Click into any cell to change:

- Product name, unit cost, arrival quantity, purchased quantity
- Sample evaluation (Pass / Fail / In progress)
- Decision (Scale / Kill / Sample)
- Quantity sold, average sold price

Computed fields (total price, current stock, revenue, margin) update after you click **Save**.

#### Save / Archive / Delete

| Action | When to use |
|--------|-------------|
| **Save** | Apply edits to the current row |
| **Archive** | Product is completely sold out and you will not restock. Hides the item from this dashboard and the high-level view. Historical earnings still count in Project Summary. |
| **Delete** | Remove a SKU added by mistake. Permanently removes the item and all its data. |

#### Filters and search

- **Search** — filter by SKU code, name, or decision
- **Sample Evaluation / Decision / Stock** — narrow the table
- **Clear filters** — reset all filters

#### Export

Click **Export to Excel** to download `Flea_Market_Export.xlsx` with Project, Accessory, and SKU sheets.

#### Total inventory cost

Shown below the table — sum of purchase costs for all active (non-archived) SKUs.

---

### Accessory Dashboard

Track non-product costs such as booth fees and supplies.

#### Add an accessory

1. Enter **Name** (e.g. "Booth rental")
2. Select **Category**: **Exhibition** or **Application**
3. Enter **Cost**
4. Click **Add Accessory**

#### Edit / Delete

- Change name, category, or cost inline, then click **Save**
- Click **Delete** to remove an entry

**Total accessory cost** is shown below the table.

---

### Alerts

Click **Refresh Alerts** to see recommendations:

- Low stock warnings
- Scale-up candidates (strong sellers)
- Slow items (candidates for the kill list)
- Items marked "Scale" in the decision column

Archived SKUs are excluded from alerts.

---

## Data Storage

| File | Purpose |
|------|---------|
| `data.sqlite` | All project, SKU, accessory, and inventory data |
| `public/index.html` | Dashboard layout |
| `public/app.js` | Dashboard logic |
| `public/styles.css` | Dashboard styles |
| `src/server.js` | API server |
| `src/db.js` | Database logic |

Back up `data.sqlite` to preserve your data.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dashboard/totals` | Project cost and earning totals |
| GET | `/api/inventory/stock` | All SKUs with stock and sales data |
| PATCH | `/api/inventory/sku/:id` | Update a SKU row |
| GET | `/api/sku/next-code` | Next suggested SKU code |
| POST | `/api/sku` | Create a SKU |
| POST | `/api/sku/:id/archive` | Archive a SKU |
| DELETE | `/api/sku/:id` | Permanently delete a SKU |
| GET | `/api/accessory` | List accessories |
| POST | `/api/accessory` | Add an accessory |
| PATCH | `/api/accessory/:id` | Update an accessory |
| DELETE | `/api/accessory/:id` | Delete an accessory |
| GET | `/api/export/excel` | Download Excel export |
| GET | `/api/alerts` | Inventory alerts |

---

## Troubleshooting

**Port already in use** — another instance is running. Stop it or set a different port:

```bash
set PORT=3001 && npm run dev
```

**Excel export fails** — Python with `openpyxl` must be installed:

```bash
pip install openpyxl
```

**Data looks wrong after edits** — click **Save** on the row after changing values. Unsaved edits are lost on refresh.
