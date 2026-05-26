const { query } = require('../db/postgres');
const { logActivity } = require('../utils/activityLog');

// Read a numeric setting from the settings table with a fallback default.
async function getNumericSetting(key, fallback) {
  try {
    const { rows } = await query(`SELECT value FROM settings WHERE key = $1`, [key]);
    if (!rows.length) return fallback;
    const v = rows[0].value;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch (_err) {
    return fallback;
  }
}

/**
 * Re-evaluate the reorder alert for a single variant after a stock change.
 *
 * - If stock_qty <= reorder_threshold (and threshold > 0): create or refresh
 *   a pending reorder_alert. Returns { created: true } when a new alert was
 *   inserted.
 * - If stock_qty > reorder_threshold: auto-resolve any pending alert by
 *   marking it `dismissed` (auto-resolved by the system).
 */
async function checkReorderThreshold(variantId) {
  const { rows: variantRows } = await query(
    `SELECT v.id, v.product_id, v.stock_qty, v.reorder_threshold,
            p.name AS product_name, p.reorder_threshold AS product_threshold,
            p.unit_label
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = $1`,
    [variantId],
  );
  if (!variantRows.length) return null;

  const v = variantRows[0];
  const threshold = Number(
    v.reorder_threshold != null ? v.reorder_threshold : v.product_threshold || 0,
  );
  const current = Number(v.stock_qty);

  // Threshold of 0 means "no alert" (disabled).
  if (!threshold || threshold <= 0) {
    // Still auto-resolve any pending alert just in case the threshold was
    // changed to disabled while an alert was open.
    await autoResolvePending(variantId);
    return { created: false, threshold: 0 };
  }

  if (current > threshold) {
    const resolved = await autoResolvePending(variantId);
    return { created: false, resolved: resolved };
  }

  // Recommend at least (threshold * multiplier) - current_stock.
  const multiplier = await getNumericSetting('inventory.default_reorder_multiplier', 2);
  const recommended = Math.max(threshold * multiplier - current, 1);

  // Insert a new pending alert if there isn't one already. The partial
  // unique index uq_reorder_pending_variant turns this into a fast upsert.
  const { rows: existing } = await query(
    `SELECT id FROM reorder_alerts
      WHERE variant_id = $1 AND status = 'pending' LIMIT 1`,
    [variantId],
  );

  if (existing.length) {
    // Refresh the snapshot on the existing alert.
    await query(
      `UPDATE reorder_alerts
          SET current_stock = $1,
              reorder_point = $2,
              recommended_order_qty = $3
        WHERE id = $4`,
      [current, threshold, recommended, existing[0].id],
    );
    return {
      created: false,
      updated: true,
      alertId: existing[0].id,
    };
  }

  const { rows: insertRows } = await query(
    `INSERT INTO reorder_alerts
       (product_id, variant_id, current_stock, reorder_point, recommended_order_qty)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id`,
    [v.product_id, variantId, current, threshold, recommended],
  );
  const alertId = insertRows[0].id;

  await logActivity({
    entityType: 'reorder_alert',
    entityId: alertId,
    action: 'stock.reorder_alert_created',
    performedBy: null,
    notes: `${v.product_name}: ${current} ${v.unit_label || ''} <= ${threshold}`,
  });

  const payload = {
    alertId,
    productId: v.product_id,
    variantId,
    productName: v.product_name,
    currentStock: current,
    reorderPoint: threshold,
    recommendedOrderQty: recommended,
    unitLabel: v.unit_label,
  };

  return { created: true, alertId, payload };
}

async function autoResolvePending(variantId) {
  const { rows } = await query(
    `SELECT id FROM reorder_alerts
      WHERE variant_id = $1 AND status = 'pending'`,
    [variantId],
  );
  if (!rows.length) return 0;
  await query(
    `UPDATE reorder_alerts
        SET status = 'dismissed',
            dismissed_at = NOW()
      WHERE variant_id = $1 AND status = 'pending'`,
    [variantId],
  );
  return rows.length;
}

module.exports = { checkReorderThreshold };
