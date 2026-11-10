const { query } = require('../db/postgres');
const lifecycle = require('./productLifecycleService');
const valuation = require('./inventoryValuationService');
const { storeDate } = require('../utils/dates');

// Product lifecycle reports, set-based (one or two queries per report, never
// one per product). Definitions are those of productLifecycleService. Each
// returns the generic report shape { type, title, period, columns, rows, totals }
// that reportService renders and exports (CSV, Excel, PDF).

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const qty = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (n) => (n == null ? null : Math.round(n * 10) / 10);

// --- Inventory aging ------------------------------------------------------
async function inventoryAging({ label }) {
  const { rows } = await query(
    `SELECT p.id AS product_id, p.name AS product_name, b.variant_id, r.id, r.batch_id, b.batch_number,
            r.received_at, r.unit_cost::float8 AS unit_cost,
            r.qty_on_hand::float8 AS on_hand, r.qty_quarantined::float8 AS quarantined, v.cost_price::float8 AS average
       FROM inventory_batch_receipts r
       JOIN inventory_batches b ON b.id = r.batch_id
       JOIN product_variants v ON v.id = b.variant_id
       JOIN products p ON p.id = b.product_id
      WHERE r.qty_on_hand + r.qty_quarantined > 0
      ORDER BY p.name, r.received_at`,
  );
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, { name: r.product_name, receipts: [], averages: new Map() });
    const p = byProduct.get(r.product_id);
    p.receipts.push(r);
    p.averages.set(r.variant_id, r.average);
  }
  const out = [];
  for (const p of byProduct.values()) {
    const a = lifecycle.agingFrom(p.receipts, p.averages);
    const row = {
      product_name: p.name,
      on_hand: a.remainingUnits,
      average_age_days: a.averageAgeDays,
      oldest_received: a.oldestRemaining ? storeDate(new Date(a.oldestRemaining.receivedAt)) : null,
      oldest_age_days: a.oldestRemaining?.days ?? null,
      physical_value: money(a.buckets.reduce((s, b) => s + b.physicalValue, 0)),
      book_value: money(a.buckets.reduce((s, b) => s + b.bookValue, 0)),
    };
    for (const b of a.buckets) row[`age_${b.key}`] = b.quantity;
    out.push(row);
  }
  out.sort((x, y) => (y.oldest_age_days || 0) - (x.oldest_age_days || 0));
  const sum = (k) => money(out.reduce((s, r) => s + Number(r[k] || 0), 0));
  return {
    type: 'inventory_aging',
    title: 'Inventory Aging',
    period: { label },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'on_hand', label: 'Remaining', type: 'number', align: 'right' },
      ...lifecycle.AGING_BUCKETS.map((b) => ({ key: `age_${b.key}`, label: b.label, type: 'number', align: 'right' })),
      { key: 'average_age_days', label: 'Avg Age (days)', type: 'number', align: 'right' },
      { key: 'oldest_received', label: 'Oldest Receipt', type: 'date' },
      { key: 'oldest_age_days', label: 'Oldest (days)', type: 'number', align: 'right' },
      { key: 'physical_value', label: 'Capital Tied (batch cost)', type: 'currency', align: 'right' },
      { key: 'book_value', label: 'Book Value', type: 'currency', align: 'right' },
    ],
    rows: out,
    totals: { on_hand: sum('on_hand'), physical_value: sum('physical_value'), book_value: sum('book_value') },
  };
}

// --- Movement, turnover and velocity per product --------------------------
// Opening position is at the end of the day before the period; book values
// are null for a product when a movement it depends on has no recorded
// value (before migration 061).
async function performanceRows({ startDate, endDate, deadStockDays }) {
  const { rows } = await query(
    `WITH m AS (
       SELECT v.product_id, sm.movement_type, sm.reference_type, sm.quantity, sm.value_change, sm.timestamp
         FROM stock_movements sm JOIN product_variants v ON v.id = sm.variant_id
     ), agg AS (
       SELECT product_id,
              SUM(quantity) FILTER (WHERE timestamp::date >= $1::date AND movement_type NOT IN ('quarantine', 'quarantine_release')) AS qty_since_start,
              SUM(quantity) FILTER (WHERE timestamp::date > $2::date AND movement_type NOT IN ('quarantine', 'quarantine_release')) AS qty_after_end,
              SUM(value_change) FILTER (WHERE timestamp::date >= $1::date) AS value_since_start,
              SUM(value_change) FILTER (WHERE timestamp::date > $2::date) AS value_after_end,
              BOOL_OR(value_change IS NULL AND timestamp::date >= $1::date AND movement_type NOT IN ('quarantine', 'quarantine_release')) AS missing_value,
              SUM(quantity) FILTER (WHERE timestamp::date BETWEEN $1::date AND $2::date AND movement_type IN ('purchase', 'opening_stock')) AS received,
              -SUM(quantity) FILTER (WHERE timestamp::date BETWEEN $1::date AND $2::date AND movement_type = 'sale') AS sold,
              SUM(quantity) FILTER (WHERE timestamp::date BETWEEN $1::date AND $2::date AND movement_type = 'return_in'
                AND reference_type IN ('return_order', 'invoice_cancel', 'invoice_edit')) AS returned,
              -SUM(value_change) FILTER (WHERE timestamp::date BETWEEN $1::date AND $2::date AND movement_type = 'sale') AS cogs_out,
              SUM(value_change) FILTER (WHERE timestamp::date BETWEEN $1::date AND $2::date AND movement_type = 'return_in'
                AND reference_type IN ('return_order', 'invoice_cancel', 'invoice_edit')) AS cogs_back,
              MAX(timestamp) FILTER (WHERE movement_type = 'sale') AS last_sale
         FROM m GROUP BY product_id
     )
     SELECT p.id, p.name, COALESCE(SUM(v.stock_qty), 0)::float8 AS on_hand,
            COALESCE(SUM(v.stock_qty + v.quarantine_qty), 0)::float8 AS held_now,
            COALESCE(SUM(v.inventory_value), 0)::float8 AS value_now,
            COALESCE(a.qty_since_start, 0)::float8 AS qty_since_start, COALESCE(a.qty_after_end, 0)::float8 AS qty_after_end,
            COALESCE(a.value_since_start, 0)::float8 AS value_since_start, COALESCE(a.value_after_end, 0)::float8 AS value_after_end,
            COALESCE(a.missing_value, false) AS missing_value,
            COALESCE(a.received, 0)::float8 AS received, COALESCE(a.sold, 0)::float8 AS sold,
            COALESCE(a.returned, 0)::float8 AS returned, COALESCE(a.cogs_out, 0)::float8 AS cogs_out,
            COALESCE(a.cogs_back, 0)::float8 AS cogs_back, a.last_sale
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN agg a ON a.product_id = p.id
      WHERE p.is_active = true OR v.stock_qty > 0
      GROUP BY p.id, p.name, a.product_id, a.qty_since_start, a.qty_after_end, a.value_since_start, a.value_after_end,
               a.missing_value, a.received, a.sold, a.returned, a.cogs_out, a.cogs_back, a.last_sale
      ORDER BY p.name`,
    [startDate, endDate],
  );
  const days = Math.max(1, Math.round((new Date(`${endDate}T23:59:59`) - new Date(`${startDate}T00:00:00`)) / 86400000));
  return rows.map((r) => {
    const openingUnits = qty(r.held_now - r.qty_since_start);
    const netSold = qty(r.sold - r.returned);
    const available = qty(openingUnits + r.received);
    const velocity = netSold > 0 ? netSold / days : 0;
    const cover = velocity > 0 ? Math.round((r.on_hand / velocity) * 10) / 10 : null;
    const openingValue = r.missing_value ? null : money(r.value_now - r.value_since_start);
    const closingValue = r.missing_value ? null : money(r.value_now - r.value_after_end);
    const averageValue = openingValue == null ? null : money((openingValue + closingValue) / 2);
    const netCogs = money(r.cogs_out - r.cogs_back);
    const daysSinceSale = r.last_sale ? Math.floor((Date.now() - new Date(r.last_sale)) / 86400000) : null;
    let classification;
    if (r.on_hand > 0 && (daysSinceSale == null || daysSinceSale > deadStockDays)) classification = 'dead';
    else if (!r.last_sale) classification = 'no_sales';
    else if (cover == null || cover > 90) classification = 'slow';
    else if (cover <= 30) classification = 'fast';
    else classification = 'normal';
    return {
      product_name: r.name,
      on_hand: qty(r.on_hand),
      opening_units: openingUnits,
      received: qty(r.received),
      net_sold: netSold,
      velocity_per_day: Math.round(velocity * 100) / 100,
      days_of_cover: cover,
      sell_through_pct: available > 0 ? pct((netSold / available) * 100) : null,
      last_sale: r.last_sale ? storeDate(new Date(r.last_sale)) : null,
      days_since_sale: daysSinceSale,
      classification,
      opening_value: openingValue,
      closing_value: closingValue,
      average_value: averageValue,
      net_cogs: netCogs,
      turnover: averageValue && averageValue > 0 ? Math.round((netCogs / averageValue) * 100) / 100 : null,
    };
  });
}

async function slowMoving({ startDate, endDate, label, deadStockDays }) {
  const order = { dead: 0, slow: 1, no_sales: 2, normal: 3, fast: 4 };
  const rows = (await performanceRows({ startDate, endDate, deadStockDays }))
    .sort((a, b) => order[a.classification] - order[b.classification] || (b.days_of_cover || 0) - (a.days_of_cover || 0));
  return {
    type: 'slow_moving',
    title: 'Fast & Slow Moving Products',
    period: { startDate, endDate, label },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'classification', label: 'Movement' },
      { key: 'on_hand', label: 'On Hand', type: 'number', align: 'right' },
      { key: 'net_sold', label: 'Net Sold', type: 'number', align: 'right' },
      { key: 'velocity_per_day', label: 'Units / Day', type: 'number', align: 'right' },
      { key: 'days_of_cover', label: 'Days of Cover', type: 'number', align: 'right' },
      { key: 'sell_through_pct', label: 'Sell-through %', type: 'percent', align: 'right' },
      { key: 'last_sale', label: 'Last Sale', type: 'date' },
      { key: 'days_since_sale', label: 'Days Since Sale', type: 'number', align: 'right' },
    ],
    rows,
    totals: { on_hand: qty(rows.reduce((s, r) => s + r.on_hand, 0)), net_sold: qty(rows.reduce((s, r) => s + r.net_sold, 0)) },
  };
}

async function inventoryTurnover({ startDate, endDate, label, deadStockDays }) {
  const rows = (await performanceRows({ startDate, endDate, deadStockDays }))
    .sort((a, b) => (b.turnover ?? -1) - (a.turnover ?? -1));
  const sum = (k) => money(rows.reduce((s, r) => s + Number(r[k] || 0), 0));
  const avg = rows.every((r) => r.average_value != null) ? sum('average_value') : null;
  return {
    type: 'inventory_turnover',
    title: 'Inventory Turnover',
    period: { startDate, endDate, label },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'opening_value', label: 'Opening Value', type: 'currency', align: 'right' },
      { key: 'closing_value', label: 'Closing Value', type: 'currency', align: 'right' },
      { key: 'average_value', label: 'Average Value', type: 'currency', align: 'right' },
      { key: 'net_cogs', label: 'Net COGS', type: 'currency', align: 'right' },
      { key: 'turnover', label: 'Turnover', type: 'number', align: 'right' },
      { key: 'sell_through_pct', label: 'Sell-through %', type: 'percent', align: 'right' },
    ],
    rows,
    totals: {
      opening_value: sum('opening_value'), closing_value: sum('closing_value'), average_value: avg ?? sum('average_value'),
      net_cogs: sum('net_cogs'), turnover: avg && avg > 0 ? Math.round((sum('net_cogs') / avg) * 100) / 100 : null,
    },
  };
}

// --- Profitability by cost group, receipt and supplier --------------------
// Each sale line's net figures are shared across its allocations by units
// kept (sold less returned); card fees by units sold. Sales from before
// allocations existed have none and are reported as unallocated.
async function allocationEconomics({ startDate, endDate }) {
  const lines = await lifecycle.loadLines(null, { startDate, endDate });
  const allocations = await lifecycle.loadAllocations(lines.map((l) => l.id));
  const byId = new Map(lines.map((l) => [l.id, l]));
  const allocatedLines = new Set();
  const parts = [];
  for (const a of allocations) {
    const l = byId.get(a.invoice_item_id);
    if (!l) continue;
    allocatedLines.add(l.id);
    const f = lifecycle.lineFigures(l);
    const kept = qty(a.quantity - a.returned_qty);
    const lineKept = qty(l.quantity - l.returned_qty);
    const share = lineKept > 0 ? kept / lineKept : 0;
    parts.push({
      ...a,
      product_id: l.product_id,
      kept,
      revenue: f.revenue * share,
      cogs: f.cogs * share,
      physical: kept * a.unit_cost,
      fees: l.fees * (a.quantity / (l.quantity || 1)),
      days: a.received_at ? Math.max(0, (new Date(a.created_at) - new Date(a.received_at)) / 86400000) : null,
    });
  }
  const unallocated = lines.filter((l) => !allocatedLines.has(l.id)).reduce((t, l) => {
    const f = lifecycle.lineFigures(l);
    t.revenue += f.revenue; t.cogs += f.cogs; t.fees += f.fees; t.units += f.netQuantity;
    return t;
  }, { revenue: 0, cogs: 0, fees: 0, units: 0 });
  return { parts, unallocated };
}

function profitRow(g) {
  const gross = money(g.revenue - g.cogs);
  return {
    units_kept: qty(g.kept),
    revenue: money(g.revenue),
    book_cogs: money(g.cogs),
    gross_profit: gross,
    margin: g.revenue > 0 ? pct((gross / g.revenue) * 100) : null,
    physical_cost: money(g.physical),
    physical_gross_profit: money(g.revenue - g.physical),
    card_fees: money(g.fees),
    contribution: money(gross - g.fees),
    average_days_to_sale: g.dayUnits > 0 ? Math.round((g.dayTotal / g.dayUnits) * 10) / 10 : null,
  };
}

function accumulate(map, key, seed, p) {
  if (!map.has(key)) map.set(key, { ...seed, kept: 0, revenue: 0, cogs: 0, physical: 0, fees: 0, dayTotal: 0, dayUnits: 0 });
  const g = map.get(key);
  g.kept += p.kept; g.revenue += p.revenue; g.cogs += p.cogs; g.physical += p.physical; g.fees += p.fees;
  if (p.days != null) { g.dayTotal += p.days * p.quantity; g.dayUnits += p.quantity; }
}

const PROFIT_COLUMNS = [
  { key: 'units_kept', label: 'Units Sold (net)', type: 'number', align: 'right' },
  { key: 'revenue', label: 'Net Revenue', type: 'currency', align: 'right' },
  { key: 'book_cogs', label: 'COGS (book)', type: 'currency', align: 'right' },
  { key: 'gross_profit', label: 'Gross Profit', type: 'currency', align: 'right' },
  { key: 'margin', label: 'Margin %', type: 'percent', align: 'right' },
  { key: 'physical_cost', label: 'Batch Cost', type: 'currency', align: 'right' },
  { key: 'physical_gross_profit', label: 'Profit at Batch Cost', type: 'currency', align: 'right' },
  { key: 'card_fees', label: 'Card Fees', type: 'currency', align: 'right' },
  { key: 'contribution', label: 'Contribution', type: 'currency', align: 'right' },
  { key: 'average_days_to_sale', label: 'Avg Days to Sale', type: 'number', align: 'right' },
];
const sumCols = (rows) => Object.fromEntries(
  ['units_kept', 'revenue', 'book_cogs', 'gross_profit', 'physical_cost', 'physical_gross_profit', 'card_fees', 'contribution']
    .map((k) => [k, money(rows.reduce((s, r) => s + Number(r[k] || 0), 0))]),
);

async function costGroupProfitability({ startDate, endDate, label, level = 'group' }) {
  const { parts, unallocated } = await allocationEconomics({ startDate, endDate });
  const { rows: meta } = await query(
    `SELECT b.id AS batch_id, b.batch_number, b.unit_cost::float8 AS unit_cost, p.name AS product_name, v.sku,
            r.id AS receipt_id, r.received_at, s.name AS supplier_name, po.po_number,
            (r.qty_on_hand + r.qty_quarantined)::float8 AS receipt_remaining,
            (b.qty_on_hand + b.qty_quarantined)::float8 AS group_remaining
       FROM inventory_batches b
       JOIN products p ON p.id = b.product_id JOIN product_variants v ON v.id = b.variant_id
       LEFT JOIN inventory_batch_receipts r ON r.batch_id = b.id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN purchase_orders po ON r.source_type = 'purchase_order' AND po.id = r.source_id`,
  );
  const groups = new Map();
  for (const p of parts) {
    const key = level === 'receipt' ? (p.receipt_id || `batch:${p.batch_id}`) : p.batch_id;
    accumulate(groups, key, { batch_id: p.batch_id, receipt_id: p.receipt_id }, p);
  }
  const metaByBatch = new Map();
  const metaByReceipt = new Map();
  for (const m of meta) {
    metaByBatch.set(m.batch_id, m);
    if (m.receipt_id) metaByReceipt.set(m.receipt_id, m);
  }
  const rows = [...groups.values()].map((g) => {
    const m = (level === 'receipt' && g.receipt_id ? metaByReceipt.get(g.receipt_id) : null) || metaByBatch.get(g.batch_id) || {};
    // Sold before receipts were tracked: the cost group is known, the receipt is not.
    const unknownReceipt = level === 'receipt' && !g.receipt_id;
    return {
      product_name: m.product_name,
      sku: m.sku,
      batch_number: m.batch_number,
      ...(level === 'receipt' ? {
        received_at: !unknownReceipt && m.received_at ? storeDate(new Date(m.received_at)) : null,
        supplier: unknownReceipt ? 'Receipt not recorded (sold before receipt tracking)' : m.supplier_name || null,
        po_number: unknownReceipt ? null : m.po_number || null,
        remaining: unknownReceipt ? null : qty(m.receipt_remaining),
      } : { remaining: qty(m.group_remaining) }),
      unit_cost: m.unit_cost,
      ...profitRow(g),
    };
  }).sort((a, b) => b.contribution - a.contribution);
  if (unallocated.revenue || unallocated.units) {
    rows.push({
      product_name: 'Sales before batch tracking', batch_number: '—', units_kept: qty(unallocated.units),
      revenue: money(unallocated.revenue), book_cogs: money(unallocated.cogs),
      gross_profit: money(unallocated.revenue - unallocated.cogs), card_fees: money(unallocated.fees),
      contribution: money(unallocated.revenue - unallocated.cogs - unallocated.fees),
    });
  }
  const isReceipt = level === 'receipt';
  return {
    type: isReceipt ? 'receipt_profitability' : 'cost_group_profitability',
    title: isReceipt ? 'Profitability by Receipt' : 'Profitability by Cost Group',
    period: { startDate, endDate, label },
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'sku', label: 'SKU' },
      { key: 'batch_number', label: 'Cost Group' },
      ...(isReceipt ? [
        { key: 'received_at', label: 'Received', type: 'date' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'po_number', label: 'PO' },
      ] : []),
      { key: 'unit_cost', label: 'Unit Cost', type: 'currency', align: 'right' },
      { key: 'remaining', label: 'Remaining', type: 'number', align: 'right' },
      ...PROFIT_COLUMNS,
    ],
    rows,
    totals: sumCols(rows),
  };
}

async function supplierProfitability({ startDate, endDate, label }) {
  const { parts } = await allocationEconomics({ startDate, endDate });
  const { rows: meta } = await query(
    `SELECT r.id AS receipt_id, s.id AS supplier_id, COALESCE(s.name, 'No supplier (opening or adjusted stock)') AS supplier_name
       FROM inventory_batch_receipts r LEFT JOIN suppliers s ON s.id = r.supplier_id`,
  );
  const supplierOf = new Map(meta.map((m) => [m.receipt_id, m]));
  const { rows: received } = await query(
    `SELECT r.supplier_id, SUM(r.quantity)::float8 AS units, SUM(r.quantity * r.unit_cost)::float8 AS cost
       FROM inventory_batch_receipts r
      WHERE r.source_type = 'purchase_order' AND r.received_at::date BETWEEN $1::date AND $2::date
      GROUP BY r.supplier_id`,
    [startDate, endDate],
  );
  const groups = new Map();
  for (const p of parts) {
    const s = supplierOf.get(p.receipt_id) || { supplier_id: null, supplier_name: 'Unknown receipt' };
    accumulate(groups, s.supplier_id || s.supplier_name, { supplier_id: s.supplier_id, supplier: s.supplier_name }, p);
  }
  const receivedBy = new Map(received.map((r) => [r.supplier_id, r]));
  const rows = [...groups.values()].map((g) => ({
    supplier: g.supplier,
    units_received: qty(receivedBy.get(g.supplier_id)?.units),
    purchase_cost: money(receivedBy.get(g.supplier_id)?.cost),
    ...profitRow(g),
  })).sort((a, b) => b.contribution - a.contribution);
  return {
    type: 'supplier_profitability',
    title: 'Profitability by Supplier',
    period: { startDate, endDate, label },
    columns: [
      { key: 'supplier', label: 'Supplier' },
      { key: 'units_received', label: 'Units Received', type: 'number', align: 'right' },
      { key: 'purchase_cost', label: 'Purchased (cost)', type: 'currency', align: 'right' },
      ...PROFIT_COLUMNS,
    ],
    rows,
    totals: { ...sumCols(rows), purchase_cost: money(rows.reduce((s, r) => s + r.purchase_cost, 0)) },
  };
}

// --- Valuation reconciliation ---------------------------------------------
async function valuationReconciliation({ label }) {
  const rec = await valuation.getReconciliation();
  const rows = [
    { check: 'Ledger inventory (1004)', result: rec.ledgerInventory, status: '' },
    { check: 'Book value (weighted average)', result: rec.bookValue, status: '' },
    { check: 'Difference', result: rec.difference, status: rec.difference === 0 ? 'OK' : 'GAP' },
    { check: 'Physical batch cost (for comparison)', result: rec.physicalBatchCost, status: '' },
    ...rec.checks.map((c) => ({ check: c.label, result: c.issues.length, status: c.ok ? 'OK' : 'ISSUES' })),
  ];
  return {
    type: 'inventory_reconciliation',
    title: 'Inventory Valuation Reconciliation',
    period: { label },
    columns: [
      { key: 'check', label: 'Check' },
      { key: 'result', label: 'Amount / Issues', type: 'number', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows,
    summary: { reconciled: rec.reconciled, difference: rec.difference, policy: rec.policy },
  };
}

module.exports = {
  inventoryAging, slowMoving, inventoryTurnover, costGroupProfitability, supplierProfitability, valuationReconciliation,
};
