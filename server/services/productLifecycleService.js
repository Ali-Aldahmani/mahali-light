const { query } = require('../db/postgres');
const { todayStoreDate } = require('../utils/dates');

// Product lifecycle: from purchase receipt to sale, return and what remains.
//
// Definitions, used everywhere here and in the lifecycle reports:
//  - Net revenue: ex-VAT, after line and invoice discounts (shared across an
//    invoice's lines by value), less returns at their ex-VAT value. A
//    replacement invoice's lines count at full price (see productProfitService).
//  - COGS: the book value each sale line removed (weighted average,
//    invoice_items.cogs_value), less what came back (cogs_returned).
//  - Gross profit = net revenue - COGS. Contribution = gross profit - card
//    fees (payment_fees shared across the invoice's lines by value).
//  - Physical cost: what the units' cost batch was bought at; shown beside
//    the book figures, never instead of them.
//  - Aging uses each receipt's own date and remaining units.
// Warranty replacement invoices are left out (their cost is warranty expense).

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const qty = (n) => Math.round((Number(n) || 0) * 100) / 100;
const DAY = 86400;

// Every confirmed sale line of the given products (all products when $1 is
// NULL), with its economics. $2/$3 = optional period on the sale date.
const LINES_SQL = `
  WITH inv_lines AS (
    SELECT ii.*, i.invoice_number, i.confirmed_at, i.taxable_amount, i.tax_rate, i.customer_id,
           SUM(ii.line_total) OVER (PARTITION BY ii.invoice_id) AS invoice_lines,
           SUM(CASE WHEN ii.line_total > 0 THEN ii.line_total ELSE 0 END) OVER (PARTITION BY ii.invoice_id) AS invoice_positive,
           EXISTS (SELECT 1 FROM return_orders ro WHERE ro.replacement_invoice_id = i.id) AS is_replacement
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
     WHERE i.status = 'confirmed'
       AND ($1::uuid[] IS NULL OR ii.invoice_id IN (SELECT invoice_id FROM invoice_items WHERE product_id = ANY($1)))
       AND NOT EXISTS (SELECT 1 FROM warranty_claims wc WHERE wc.replacement_invoice_id = i.id)
       AND ($2::date IS NULL OR i.confirmed_at::date >= $2::date)
       AND ($3::date IS NULL OR i.confirmed_at::date <= $3::date)
  )
  SELECT l.id, l.invoice_id, l.invoice_number, l.confirmed_at, l.product_id, l.variant_id, l.sku,
         l.quantity::float8 AS quantity, l.unit_price::float8 AS unit_price,
         l.discount_amount::float8 AS discount_amount, l.line_total::float8 AS line_total,
         l.is_replacement,
         (CASE WHEN l.is_replacement THEN l.line_total
               ELSE COALESCE(l.line_total * l.taxable_amount / NULLIF(l.invoice_lines, 0), 0) END)::float8 AS revenue,
         COALESCE(l.cogs_value, l.quantity * l.cost_price_at_time)::float8 AS cogs,
         l.cogs_returned::float8 AS cogs_returned,
         COALESCE(ret.qty, 0)::float8 AS returned_qty,
         COALESCE(ret.value / (1 + COALESCE(l.tax_rate, 0) / 100), 0)::float8 AS returned_revenue,
         COALESCE(ret.replaced, false) AS exchanged,
         COALESCE(fee.amount * CASE WHEN l.line_total > 0 THEN l.line_total ELSE 0 END / NULLIF(l.invoice_positive, 0), 0)::float8 AS fees
    FROM inv_lines l
    LEFT JOIN LATERAL (
      SELECT SUM(rri.quantity) AS qty, SUM(rri.total_value) AS value,
             BOOL_OR(ro.return_type = 'customer_replace') AS replaced
        FROM return_request_items rri
        JOIN return_orders ro ON ro.return_request_id = rri.return_request_id
       WHERE rri.invoice_item_id = l.id AND ro.return_type IN ('customer_refund', 'customer_replace')
    ) ret ON true
    LEFT JOIN LATERAL (
      SELECT SUM(f.amount) AS amount FROM payment_fees f WHERE f.invoice_id = l.invoice_id
    ) fee ON true
   WHERE l.product_id IS NOT NULL AND ($1::uuid[] IS NULL OR l.product_id = ANY($1))`;

function lineFigures(l) {
  const revenue = money(l.revenue - l.returned_revenue);
  const cogs = money(l.cogs - l.cogs_returned);
  const grossProfit = money(revenue - cogs);
  return {
    netQuantity: qty(l.quantity - l.returned_qty),
    revenue,
    cogs,
    grossProfit,
    fees: money(l.fees),
    contribution: money(grossProfit - l.fees),
  };
}

async function loadLines(productIds, { startDate = null, endDate = null } = {}) {
  const { rows } = await query(`${LINES_SQL} ORDER BY l.confirmed_at DESC, l.id`, [productIds, startDate, endDate]);
  return rows;
}

// Allocations of the given sale lines, with batch and receipt.
async function loadAllocations(lineIds) {
  if (!lineIds.length) return [];
  const { rows } = await query(
    `SELECT a.id, a.invoice_item_id, a.quantity::float8 AS quantity, a.returned_qty::float8 AS returned_qty,
            a.unit_cost::float8 AS unit_cost, a.created_at, a.batch_id, b.batch_number,
            a.receipt_id, r.received_at, r.source_type, r.source_id, s.name AS supplier_name, po.po_number
       FROM inventory_batch_allocations a
       JOIN inventory_batches b ON b.id = a.batch_id
       LEFT JOIN inventory_batch_receipts r ON r.id = a.receipt_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN purchase_orders po ON r.source_type = 'purchase_order' AND po.id = r.source_id
      WHERE a.invoice_item_id = ANY($1)
      ORDER BY a.created_at, a.id`,
    [lineIds],
  );
  return rows;
}

// Every receipt of the given products, newest first, with remaining units.
async function loadReceipts(productIds) {
  const { rows } = await query(
    `SELECT r.id, r.batch_id, b.batch_number, b.variant_id, v.sku, b.unit_cost::float8 AS group_cost,
            r.unit_cost::float8 AS unit_cost, r.source_type, r.source_id, r.received_at,
            r.supplier_id, s.name AS supplier_name, po.po_number,
            r.quantity::float8 AS received, r.qty_on_hand::float8 AS on_hand,
            r.qty_quarantined::float8 AS quarantined, r.qty_sold::float8 AS sold,
            r.qty_returned::float8 AS returned, r.qty_out_other::float8 AS out_other,
            u.username AS received_by
       FROM inventory_batch_receipts r
       JOIN inventory_batches b ON b.id = r.batch_id
       JOIN product_variants v ON v.id = b.variant_id
       LEFT JOIN suppliers s ON s.id = r.supplier_id
       LEFT JOIN purchase_orders po ON r.source_type = 'purchase_order' AND po.id = r.source_id
       LEFT JOIN users u ON u.id = r.employee_id
      WHERE b.product_id = ANY($1)
      ORDER BY r.received_at DESC, r.id DESC`,
    [productIds],
  );
  return rows;
}

const RECEIVING_SOURCES = new Set(['purchase_order', 'opening_stock', 'opening_balance', 'product_create', 'variant_create']);

function daysBetween(a, b) {
  return Math.max(0, (new Date(b) - new Date(a)) / 1000 / DAY);
}

const AGING_BUCKETS = [
  { key: '0_30', label: '0–30 days', max: 30 },
  { key: '31_60', label: '31–60 days', max: 60 },
  { key: '61_90', label: '61–90 days', max: 90 },
  { key: '91_180', label: '91–180 days', max: 180 },
  { key: '180_plus', label: '180+ days', max: Infinity },
];

/**
 * Stock on hand by age, from each receipt's own date. Remaining units are
 * valued at their receipt cost (physical) and at the book average.
 */
function agingFrom(receipts, averages, now = new Date()) {
  const buckets = AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, quantity: 0, physicalValue: 0, bookValue: 0 }));
  let oldest = null;
  let weightedDays = 0;
  let total = 0;
  for (const r of receipts) {
    const remaining = qty(r.on_hand + r.quarantined);
    if (remaining <= 0) continue;
    const days = daysBetween(r.received_at, now);
    const bucket = buckets[AGING_BUCKETS.findIndex((b) => days <= b.max)];
    bucket.quantity = qty(bucket.quantity + remaining);
    bucket.physicalValue = money(bucket.physicalValue + remaining * r.unit_cost);
    bucket.bookValue = money(bucket.bookValue + remaining * (averages.get(r.variant_id) || 0));
    weightedDays += remaining * days;
    total += remaining;
    if (!oldest || new Date(r.received_at) < new Date(oldest.receivedAt)) {
      oldest = { receiptId: r.id, batchNumber: r.batch_number, receivedAt: r.received_at, remaining, days: Math.floor(days) };
    }
  }
  return {
    buckets,
    remainingUnits: qty(total),
    averageAgeDays: total > 0 ? Math.round((weightedDays / total) * 10) / 10 : null,
    oldestRemaining: oldest,
  };
}

// Average days from receipt to sale, over sold units whose receipt is known.
function averageDaysToSale(allocations) {
  let units = 0;
  let days = 0;
  for (const a of allocations) {
    if (!a.received_at) continue;
    units += a.quantity;
    days += a.quantity * daysBetween(a.received_at, a.created_at);
  }
  return units > 0 ? Math.round((days / units) * 10) / 10 : null;
}

/**
 * Per variant, on-hand quantity and book value as at the end of `date`, from
 * today's figures less every movement after it. Book value is null when a
 * movement after the date has no recorded value (before migration 061).
 */
async function positionAt(productIds, date) {
  const { rows } = await query(
    `SELECT v.id AS variant_id,
            (v.stock_qty + v.quarantine_qty - COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type NOT IN ('quarantine', 'quarantine_release')), 0))::float8 AS held,
            (v.inventory_value - COALESCE(SUM(m.value_change), 0))::float8 AS value,
            BOOL_OR(m.id IS NOT NULL AND m.value_change IS NULL) AS missing_value
       FROM product_variants v
       LEFT JOIN stock_movements m ON m.variant_id = v.id AND m.timestamp::date > $2::date
      WHERE v.product_id = ANY($1)
      GROUP BY v.id`,
    [productIds, date],
  );
  return rows;
}

/**
 * Sales velocity, sell-through and turnover over a period, with the
 * classification used by the slow-moving report:
 *  - dead: stock on hand and no sale within the dead-stock window
 *  - slow: more than 90 days of cover at the current velocity
 *  - fast: 30 days of cover or less
 *  - normal: otherwise; insufficient_data when there is no sales history
 */
async function performance(productIds, { startDate, endDate, deadStockDays = 30 }) {
  const days = Math.max(1, Math.round(daysBetween(`${startDate}T00:00:00`, `${endDate}T23:59:59`)));
  const [opening, closing] = await Promise.all([
    positionAt(productIds, new Date(new Date(`${startDate}T00:00:00`) - 1).toISOString().slice(0, 10)),
    positionAt(productIds, endDate),
  ]);
  const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
  const { rows: [flow] } = await query(
    `SELECT COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type IN ('purchase', 'opening_stock')), 0)::float8 AS received,
            COALESCE(-SUM(m.quantity) FILTER (WHERE m.movement_type = 'sale'), 0)::float8 AS sold,
            COALESCE(SUM(m.quantity) FILTER (WHERE m.movement_type = 'return_in' AND m.reference_type IN ('return_order', 'invoice_cancel', 'invoice_edit')), 0)::float8 AS returned,
            COALESCE(-SUM(m.value_change) FILTER (WHERE m.movement_type = 'sale'), 0)::float8 AS cogs_out,
            COALESCE(SUM(m.value_change) FILTER (WHERE m.movement_type = 'return_in' AND m.reference_type IN ('return_order', 'invoice_cancel', 'invoice_edit')), 0)::float8 AS cogs_back,
            BOOL_OR(m.movement_type IN ('sale', 'return_in') AND m.value_change IS NULL) AS missing_value,
            MAX(m.timestamp) FILTER (WHERE m.movement_type = 'sale') AS last_sale_in_period
       FROM stock_movements m
       JOIN product_variants v ON v.id = m.variant_id
      WHERE v.product_id = ANY($1) AND m.timestamp::date BETWEEN $2::date AND $3::date`,
    [productIds, startDate, endDate],
  );
  const { rows: [last] } = await query(
    `SELECT MAX(m.timestamp) AS last_sale FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id
      WHERE v.product_id = ANY($1) AND m.movement_type = 'sale'`,
    [productIds],
  );
  const { rows: [now] } = await query(
    `SELECT COALESCE(SUM(stock_qty), 0)::float8 AS on_hand FROM product_variants WHERE product_id = ANY($1)`, [productIds],
  );
  const openingUnits = qty(sum(opening, 'held'));
  const netSold = qty(flow.sold - flow.returned);
  const available = qty(openingUnits + flow.received);
  const sellThrough = available > 0 ? Math.round((netSold / available) * 1000) / 10 : null;
  const velocity = netSold > 0 ? netSold / days : 0;
  const cover = velocity > 0 ? Math.round((Number(now.on_hand) / velocity) * 10) / 10 : null;
  const insufficient = opening.some((r) => r.missing_value) || closing.some((r) => r.missing_value) || flow.missing_value;
  const openingValue = insufficient ? null : money(sum(opening, 'value'));
  const closingValue = insufficient ? null : money(sum(closing, 'value'));
  // An approximation: the mean of the opening and closing book values.
  const averageValue = insufficient ? null : money((openingValue + closingValue) / 2);
  const netCogs = money(flow.cogs_out - flow.cogs_back);
  const turnover = averageValue && averageValue > 0 ? Math.round((netCogs / averageValue) * 100) / 100 : null;
  const lastSale = last.last_sale ? new Date(last.last_sale) : null;
  const daysSinceSale = lastSale ? Math.floor(daysBetween(lastSale, new Date())) : null;
  let classification;
  if (Number(now.on_hand) > 0 && (daysSinceSale == null || daysSinceSale > deadStockDays)) classification = 'dead';
  else if (!lastSale) classification = 'insufficient_data';
  else if (cover == null || cover > 90) classification = 'slow';
  else if (cover <= 30) classification = 'fast';
  else classification = 'normal';
  return {
    period: { startDate, endDate, days },
    openingUnits,
    receivedUnits: qty(flow.received),
    soldUnits: qty(flow.sold),
    returnedUnits: qty(flow.returned),
    netSoldUnits: netSold,
    onHand: qty(now.on_hand),
    velocityPerDay: Math.round(velocity * 100) / 100,
    daysOfCover: cover,
    sellThroughPct: sellThrough,
    lastSaleAt: lastSale,
    daysSinceLastSale: daysSinceSale,
    classification,
    // Book figures (cost permission): null when the period starts before book
    // values were recorded.
    openingValue,
    closingValue,
    averageValue,
    netCogs,
    turnover,
    turnoverNote: insufficient ? 'insufficient_history' : (averageValue === 0 ? 'no_inventory' : null),
  };
}

/**
 * Periods a variant had no sellable stock, from its movement history:
 * from the movement that took stock_qty to 0 until the next one above 0.
 */
async function stockouts(productIds, { limit = 50 } = {}) {
  const { rows } = await query(
    `WITH m AS (
       SELECT sm.variant_id, v.sku, sm.timestamp, sm.qty_after,
              LAG(sm.qty_after) OVER (PARTITION BY sm.variant_id ORDER BY sm.timestamp, sm.id) AS prev_after
         FROM stock_movements sm JOIN product_variants v ON v.id = sm.variant_id
        WHERE v.product_id = ANY($1)
     ), edges AS (
       SELECT variant_id, sku, timestamp, qty_after,
              CASE WHEN qty_after <= 0 AND COALESCE(prev_after, 1) > 0 THEN 'out'
                   WHEN qty_after > 0 AND COALESCE(prev_after, 1) <= 0 THEN 'in' END AS edge
         FROM m
     ), outs AS (
       SELECT e.variant_id, e.sku, e.timestamp AS started_at,
              (SELECT MIN(e2.timestamp) FROM edges e2 WHERE e2.variant_id = e.variant_id
                 AND e2.edge = 'in' AND e2.timestamp > e.timestamp) AS ended_at
         FROM edges e WHERE e.edge = 'out'
     )
     SELECT variant_id, sku, started_at, ended_at,
            (EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)) / 86400)::float8 AS days
       FROM outs ORDER BY started_at DESC LIMIT $2`,
    [productIds, limit],
  );
  return rows.map((r) => ({
    variantId: r.variant_id, sku: r.sku, startedAt: r.started_at, endedAt: r.ended_at,
    ongoing: !r.ended_at, days: Math.round(r.days * 10) / 10,
  }));
}

async function productHeader(productId) {
  const { rows: [p] } = await query(
    `SELECT p.id, p.name, p.unit_label, p.is_active, pc.name AS category_name
       FROM products p LEFT JOIN product_categories pc ON pc.id = p.category_id WHERE p.id = $1`,
    [productId],
  );
  return p || null;
}

async function variantTotals(productId) {
  const { rows } = await query(
    `SELECT id, sku, stock_qty::float8 AS stock, quarantine_qty::float8 AS quarantined,
            inventory_value::float8 AS book_value, cost_price::float8 AS average_cost,
            last_purchase_cost::float8 AS last_purchase_cost, selling_price::float8 AS selling_price
       FROM product_variants WHERE product_id = $1 ORDER BY sku`,
    [productId],
  );
  return rows;
}

async function lossesAndAdjustments(productIds) {
  const { rows: [r] } = await query(
    `SELECT
       COALESCE(SUM(-m.quantity) FILTER (WHERE m.quantity < 0 AND m.movement_type IN ('adjustment', 'adjustment_out')
         AND (sar.reason IN ('damaged', 'lost', 'expired') OR m.reference_type = 'quarantine')), 0)::float8 AS written_off,
       COALESCE(SUM(m.quantity) FILTER (WHERE m.quantity > 0 AND m.movement_type IN ('adjustment', 'adjustment_in', 'count_correction', 'count_correction_in')), 0)::float8 AS adjusted_in,
       COALESCE(SUM(-m.quantity) FILTER (WHERE m.quantity < 0 AND m.movement_type IN ('adjustment', 'adjustment_out', 'count_correction', 'count_correction_out')), 0)::float8 AS adjusted_out,
       COALESCE(SUM(-m.quantity) FILTER (WHERE m.movement_type = 'return_out'), 0)::float8 AS returned_to_supplier,
       COALESCE(SUM(-m.quantity) FILTER (WHERE m.movement_type = 'quarantine'), 0)::float8 AS quarantined_total
       FROM stock_movements m
       JOIN product_variants v ON v.id = m.variant_id
       LEFT JOIN stock_adjustment_requests sar ON sar.applied_movement_id = m.id
      WHERE v.product_id = ANY($1)`,
    [productIds],
  );
  return r;
}

/** Everything for the product lifecycle page except the paged lists. */
async function getLifecycle(productId, { startDate = null, endDate = null, deadStockDays = 30 } = {}) {
  const product = await productHeader(productId);
  if (!product) return null;
  const ids = [productId];
  const [variants, receipts, lines, losses, outs] = await Promise.all([
    variantTotals(productId), loadReceipts(ids), loadLines(ids, { startDate, endDate }),
    lossesAndAdjustments(ids), stockouts(ids),
  ]);
  const allocations = await loadAllocations(lines.map((l) => l.id));
  const averages = new Map(variants.map((v) => [v.id, v.average_cost]));

  const totals = lines.reduce((t, l) => {
    const f = lineFigures(l);
    t.soldUnits += l.quantity;
    t.returnedUnits += l.returned_qty;
    t.netUnits += f.netQuantity;
    t.revenue += f.revenue;
    t.cogs += f.cogs;
    t.grossProfit += f.grossProfit;
    t.fees += f.fees;
    t.contribution += f.contribution;
    return t;
  }, { soldUnits: 0, returnedUnits: 0, netUnits: 0, revenue: 0, cogs: 0, grossProfit: 0, fees: 0, contribution: 0 });

  const received = receipts.filter((r) => RECEIVING_SOURCES.has(r.source_type));
  const dates = received.map((r) => new Date(r.received_at)).sort((a, b) => a - b);
  const period = {
    startDate: startDate || (dates[0] ? dates[0].toISOString().slice(0, 10) : todayStoreDate()),
    endDate: endDate || todayStoreDate(),
  };
  const perf = await performance(ids, { ...period, deadStockDays });

  const groups = new Map();
  for (const r of receipts) {
    if (!groups.has(r.batch_id)) {
      groups.set(r.batch_id, {
        batchId: r.batch_id, batchNumber: r.batch_number, variantId: r.variant_id, sku: r.sku,
        unitCost: r.group_cost, received: 0, sold: 0, returned: 0, outOther: 0, remaining: 0,
        revenue: 0, bookCogs: 0, physicalCost: 0, fees: 0, receipts: [], allocations: [],
      });
    }
    const g = groups.get(r.batch_id);
    g.received = qty(g.received + r.received);
    g.sold = qty(g.sold + r.sold);
    g.returned = qty(g.returned + r.returned);
    g.outOther = qty(g.outOther + r.out_other);
    g.remaining = qty(g.remaining + r.on_hand + r.quarantined);
    g.receipts.push(r);
  }
  const lineById = new Map(lines.map((l) => [l.id, l]));
  for (const a of allocations) {
    const g = groups.get(a.batch_id);
    const l = lineById.get(a.invoice_item_id);
    if (!g || !l) continue;
    const f = lineFigures(l);
    const kept = qty(a.quantity - a.returned_qty);
    const lineKept = qty(l.quantity - l.returned_qty);
    const share = lineKept > 0 ? kept / lineKept : 0;
    g.revenue = money(g.revenue + f.revenue * share);
    g.bookCogs = money(g.bookCogs + f.cogs * share);
    g.physicalCost = money(g.physicalCost + kept * a.unit_cost);
    g.fees = money(g.fees + l.fees * (a.quantity / (l.quantity || 1)));
    g.allocations.push(a);
  }
  const costGroups = [...groups.values()].map((g) => ({
    batchId: g.batchId,
    batchNumber: g.batchNumber,
    variantId: g.variantId,
    sku: g.sku,
    unitCost: g.unitCost,
    received: g.received,
    sold: g.sold,
    returned: g.returned,
    outOther: g.outOther,
    remaining: g.remaining,
    remainingValue: money(g.remaining * g.unitCost),
    revenue: g.revenue,
    bookCogs: g.bookCogs,
    grossProfit: money(g.revenue - g.bookCogs),
    physicalCost: g.physicalCost,
    physicalGrossProfit: money(g.revenue - g.physicalCost),
    fees: g.fees,
    contribution: money(g.revenue - g.bookCogs - g.fees),
    averageDaysToSale: averageDaysToSale(g.allocations),
    receipts: g.receipts.map((r) => receiptView(r)),
  }));

  const stockNow = variants.reduce((s, v) => s + v.stock, 0);
  const quarantined = variants.reduce((s, v) => s + v.quarantined, 0);
  return {
    product,
    period,
    overview: {
      firstReceivedAt: dates[0] || null,
      lastReceivedAt: dates[dates.length - 1] || null,
      totalReceived: qty(received.reduce((s, r) => s + r.received, 0)),
      soldUnits: qty(totals.soldUnits),
      returnedUnits: qty(totals.returnedUnits),
      netSoldUnits: qty(totals.netUnits),
      available: qty(stockNow),
      quarantined: qty(quarantined),
      // Not supported: drafts and quotes hold no stock.
      reserved: null,
      writtenOff: qty(losses.written_off),
      adjustedIn: qty(losses.adjusted_in),
      adjustedOut: qty(losses.adjusted_out),
      returnedToSupplier: qty(losses.returned_to_supplier),
      inventoryValue: money(variants.reduce((s, v) => s + v.book_value, 0)),
      revenue: money(totals.revenue),
      cogs: money(totals.cogs),
      grossProfit: money(totals.grossProfit),
      grossMarginPct: totals.revenue > 0 ? Math.round((totals.grossProfit / totals.revenue) * 1000) / 10 : null,
      paymentFees: money(totals.fees),
      contribution: money(totals.contribution),
    },
    variants,
    costGroups,
    aging: { ...agingFrom(receipts, averages), averageDaysToSale: averageDaysToSale(allocations) },
    performance: perf,
    stockouts: outs,
  };
}

function receiptView(r) {
  return {
    receiptId: r.id,
    batchId: r.batch_id,
    batchNumber: r.batch_number,
    variantId: r.variant_id,
    sku: r.sku,
    sourceType: r.source_type,
    sourceId: r.source_id,
    purchaseOrderId: r.source_type === 'purchase_order' ? r.source_id : null,
    poNumber: r.po_number,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    receivedAt: r.received_at,
    receivedBy: r.received_by,
    unitCost: r.unit_cost,
    received: r.received,
    onHand: r.on_hand,
    quarantined: r.quarantined,
    sold: r.sold,
    returned: r.returned,
    outOther: r.out_other,
    remaining: qty(r.on_hand + r.quarantined),
    remainingValue: money((r.on_hand + r.quarantined) * r.unit_cost),
    daysInStock: Math.floor(daysBetween(r.received_at, new Date())),
  };
}

/** Receipts, paged, newest first. */
async function getReceipts(productId, { page = 1, limit = 50 } = {}) {
  const rows = await loadReceipts([productId]);
  const start = (page - 1) * limit;
  return { rows: rows.slice(start, start + limit).map(receiptView), total: rows.length, page, limit };
}

/** Sale lines of the product, paged, with their batch and receipt allocations. */
async function getSales(productId, { startDate = null, endDate = null, page = 1, limit = 50 } = {}) {
  const lines = await loadLines([productId], { startDate, endDate });
  const start = (page - 1) * limit;
  const pageLines = lines.slice(start, start + limit);
  const allocations = await loadAllocations(pageLines.map((l) => l.id));
  const byLine = new Map();
  for (const a of allocations) {
    if (!byLine.has(a.invoice_item_id)) byLine.set(a.invoice_item_id, []);
    byLine.get(a.invoice_item_id).push(a);
  }
  return {
    total: lines.length,
    page,
    limit,
    rows: pageLines.map((l) => ({
      lineId: l.id,
      invoiceId: l.invoice_id,
      invoiceNumber: l.invoice_number,
      soldAt: l.confirmed_at,
      sku: l.sku,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      discount: l.discount_amount,
      lineTotal: l.line_total,
      returnedQuantity: l.returned_qty,
      exchanged: l.exchanged,
      isReplacement: l.is_replacement,
      ...lineFigures(l),
      allocations: (byLine.get(l.id) || []).map((a) => ({
        batchId: a.batch_id,
        batchNumber: a.batch_number,
        receiptId: a.receipt_id,
        receivedAt: a.received_at,
        supplierName: a.supplier_name,
        poNumber: a.po_number,
        purchaseOrderId: a.source_type === 'purchase_order' ? a.source_id : null,
        quantity: a.quantity,
        returnedQuantity: a.returned_qty,
        unitCost: a.unit_cost,
      })),
    })),
  };
}

const TIMELINE_GROUPS = {
  purchase: ['purchase', 'opening_stock'],
  sale: ['sale'],
  return: ['return_in'],
  supplier_return: ['return_out'],
  adjustment: ['adjustment', 'adjustment_in', 'adjustment_out', 'count_correction', 'count_correction_in', 'count_correction_out'],
  quarantine: ['quarantine', 'quarantine_release'],
};

function linkFor(referenceType, referenceId) {
  if (!referenceId) return null;
  switch (referenceType) {
    case 'purchase_order': return `/purchase-orders/${referenceId}`;
    case 'invoice': case 'invoice_cancel': case 'invoice_edit': return `/invoices/${referenceId}`;
    case 'return_order': return `/returns/orders/${referenceId}`;
    case 'supplier_return': return `/suppliers?return=${referenceId}`;
    default: return null;
  }
}

/**
 * Every event of the product in time order (newest first): stock movements
 * with the batches and receipts they touched, plus price and cost changes.
 * `types` limits to TIMELINE_GROUPS keys and/or 'price_change'.
 */
async function getTimeline(productId, { types = null, startDate = null, endDate = null, page = 1, limit = 50 } = {}) {
  const wanted = types && types.length ? types : [...Object.keys(TIMELINE_GROUPS), 'price_change'];
  const movementTypes = wanted.flatMap((t) => TIMELINE_GROUPS[t] || []);
  const withPrices = wanted.includes('price_change');
  const params = [productId, movementTypes, startDate, endDate, withPrices, limit, (page - 1) * limit];
  const { rows } = await query(
    `WITH events AS (
       SELECT 'movement' AS kind, m.id, m.timestamp AS at, m.movement_type AS type, m.variant_id, v.sku,
              m.quantity::float8 AS quantity, m.qty_after::float8 AS qty_after, m.unit_cost::float8 AS unit_cost,
              m.value_change::float8 AS value_change, m.reference_type, m.reference_id, m.notes,
              u.username AS employee, ro.return_type, sar.reason AS adjustment_reason,
              (SELECT json_agg(json_build_object('batchNumber', b.batch_number, 'receiptId', bm.receipt_id,
                        'onHandChange', bm.on_hand_change::float8, 'quarantineChange', bm.quarantine_change::float8)
                        ORDER BY bm.created_at)
                 FROM inventory_batch_movements bm JOIN inventory_batches b ON b.id = bm.batch_id
                WHERE bm.stock_movement_id = m.id) AS batches,
              NULL::jsonb AS old_value, NULL::jsonb AS new_value
         FROM stock_movements m
         JOIN product_variants v ON v.id = m.variant_id
         LEFT JOIN users u ON u.id = m.employee_id
         LEFT JOIN return_orders ro ON m.reference_type = 'return_order' AND ro.id = m.reference_id
         LEFT JOIN stock_adjustment_requests sar ON sar.applied_movement_id = m.id
        WHERE m.product_id = $1 AND m.movement_type = ANY($2)
          AND ($3::date IS NULL OR m.timestamp::date >= $3::date)
          AND ($4::date IS NULL OR m.timestamp::date <= $4::date)
       UNION ALL
       SELECT 'price_change', a.id, a.timestamp, a.action, a.entity_id, v.sku,
              NULL, NULL, NULL, NULL, NULL, NULL, a.notes, a.performed_by_name, NULL, NULL, NULL,
              a.old_value, a.new_value
         FROM activity_log a
         JOIN product_variants v ON v.id = a.entity_id
        WHERE $5 AND a.entity_type = 'variant' AND v.product_id = $1
          AND a.action IN ('variant.updated', 'variant.cost_revalued')
          AND (a.new_value ? 'sellingPrice' OR a.new_value ? 'costPrice')
          AND ($3::date IS NULL OR a.timestamp::date >= $3::date)
          AND ($4::date IS NULL OR a.timestamp::date <= $4::date)
     )
     SELECT *, COUNT(*) OVER ()::int AS total FROM events
      ORDER BY at DESC, id DESC
      LIMIT $6 OFFSET $7`,
    params,
  );
  return {
    total: rows[0]?.total || 0,
    page,
    limit,
    rows: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      at: r.at,
      type: r.kind === 'movement' && r.type === 'return_in' && r.return_type === 'customer_replace' ? 'exchange_return' : r.type,
      variantId: r.variant_id,
      sku: r.sku,
      quantity: r.quantity,
      qtyAfter: r.qty_after,
      unitCost: r.unit_cost,
      valueChange: r.value_change,
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      link: linkFor(r.reference_type, r.reference_id),
      reason: r.adjustment_reason,
      notes: r.notes,
      employee: r.employee,
      batches: r.batches || [],
      oldValue: r.old_value,
      newValue: r.new_value,
    })),
  };
}

module.exports = {
  getLifecycle, getReceipts, getSales, getTimeline,
  // Shared with the lifecycle reports.
  loadLines, loadAllocations, loadReceipts, lineFigures, agingFrom, averageDaysToSale, performance, stockouts,
  AGING_BUCKETS, TIMELINE_GROUPS,
};
