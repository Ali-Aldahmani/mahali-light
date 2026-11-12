const { query } = require('../db/postgres');

// One answer to "should we buy this, and how much?" (purchase decision audit
// 2026-11-12, P0). Both the low-stock alerts (reorderService) and the
// forecast reorder suggestions (forecastService) use it, so they never
// disagree, and both count stock already on order.
//
// Inventory position = sellable on hand + on order.
//   on hand   product_variants.stock_qty (quarantined stock is apart and not sellable)
//   on order  what confirmed or partly received purchase orders still owe:
//             ordered - received - cancelled (a closed remainder is cancelled)
// Draft invoices don't hold stock (it is taken when a sale is confirmed),
// so nothing is committed against the position.
//
// The reorder point and the order-up-to level come from:
//   1. the reorder level staff set on the variant or product (it wins: a
//      person decided it), order up to level x the reorder multiplier; else
//   2. the forecast: demand over lead time + safety days, order up to that
//      plus ORDER_COVER_DAYS of demand.
// Buy when the position is at or below the reorder point: order up to the
// level, less what is on hand and on order. Otherwise wait.
//
// Advice only: nothing here creates a purchase order.

const ORDER_COVER_DAYS = 30;

// What confirmed and partly received purchase orders still owe, per variant.
// `variantRef` is the SQL expression for the variant id.
function onOrderSql(variantRef) {
  return `COALESCE((
    SELECT SUM(GREATEST(poi.quantity - poi.quantity_received - poi.quantity_cancelled, 0))
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.purchase_order_id
     WHERE poi.variant_id = ${variantRef} AND po.status IN ('confirmed', 'partially_received')
  ), 0)`;
}

async function inventoryPosition(variantId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows: [r] } = await run(
    `SELECT v.stock_qty::float8 AS on_hand,
            COALESCE(v.quarantine_qty, 0)::float8 AS quarantined,
            ${onOrderSql('v.id')}::float8 AS on_order,
            COALESCE(v.reorder_threshold, p.reorder_threshold, 0)::float8 AS reorder_level,
            p.sold_by
       FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.id = $1`,
    [variantId],
  );
  if (!r) return null;
  return {
    onHand: r.on_hand,
    quarantined: r.quarantined,
    onOrder: r.on_order,
    position: r.on_hand + r.on_order,
    reorderLevel: r.reorder_level,
    wholeUnits: !r.sold_by || r.sold_by === 'piece',
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param pos        from inventoryPosition()
 * @param forecast   { dailyAvg, reorderPoint, orderUpTo } or null
 * @param multiplier the reorder-level multiplier setting (default 2)
 */
function decide(pos, forecast = null, { multiplier = 2, today = new Date() } = {}) {
  const dailyAvg = Number(forecast?.dailyAvg) || 0;
  let basis = 'none';
  let reorderPoint = null;
  let orderUpTo = null;
  if (pos.reorderLevel > 0) {
    basis = 'reorder_level';
    reorderPoint = pos.reorderLevel;
    orderUpTo = pos.reorderLevel * Math.max(1, multiplier);
  } else if (forecast && dailyAvg > 0) {
    basis = 'forecast';
    reorderPoint = Number(forecast.reorderPoint) || 0;
    orderUpTo = Math.max(reorderPoint, Number(forecast.orderUpTo) || 0);
  }
  const buy = reorderPoint != null && pos.position <= reorderPoint + 1e-9;
  let qty = buy ? Math.max(0, orderUpTo - pos.position) : 0;
  if (qty > 0 && pos.wholeUnits) qty = Math.ceil(qty - 1e-9);
  const daysOfCover = dailyAvg > 0 ? round2(pos.position / dailyAvg) : null;
  let expectedStockoutDate = null;
  if (dailyAvg > 0) {
    const d = new Date(today.getTime() + Math.max(0, pos.onHand / dailyAvg) * 86400000);
    expectedStockoutDate = d.toISOString().slice(0, 10);
  }
  return {
    basis,
    action: buy && qty > 0 ? 'buy' : 'wait',
    reorderPoint: reorderPoint == null ? null : round2(reorderPoint),
    orderUpTo: orderUpTo == null ? null : round2(orderUpTo),
    recommendedQty: round2(qty),
    onHand: pos.onHand,
    onOrder: pos.onOrder,
    position: round2(pos.position),
    daysOfCover,
    // When the stock on hand runs out at the current rate, before anything on order arrives.
    expectedStockoutDate,
  };
}

async function reorderMultiplier(client = null) {
  const run = client ? client.query.bind(client) : query;
  try {
    const { rows } = await run(`SELECT value FROM settings WHERE key = 'inventory.default_reorder_multiplier'`);
    const n = Number(rows[0]?.value);
    return Number.isFinite(n) && n > 0 ? n : 2;
  } catch (_e) {
    return 2;
  }
}

module.exports = { ORDER_COVER_DAYS, onOrderSql, inventoryPosition, decide, reorderMultiplier };
