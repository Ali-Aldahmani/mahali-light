const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// Sales that couldn't happen because stock ran out (data readiness
// 2026-11-12). Without these, a day out of stock looks like a day nobody
// wanted the item, and true demand can never be measured afterwards.
//
// Sources:
//   sale_refused       a sale was confirmed but stock was short (automatic)
//   till_out_of_stock  the cashier tapped an out-of-stock product
//   manual             recorded by hand (e.g. a phone enquiry)
// The same refused sale retried, or the same item tapped again by the same
// person within a few minutes, counts once; `occurrences` keeps how often.

const REPEAT_WINDOW_MINUTES = 5;

async function record({ variantId, quantity = 1, availableQty = null, source, invoiceId = null, userId = null, note = null }) {
  const qty = Number(quantity);
  if (!(qty > 0)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'A lost sale needs a quantity above 0.', { status: 400 });
  }
  const { rows: [variant] } = await query(`SELECT id, product_id FROM product_variants WHERE id = $1`, [variantId]);
  if (!variant) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Product not found.', { status: 404 });

  if (invoiceId) {
    const { rows: [row] } = await query(
      `INSERT INTO lost_sales (product_id, variant_id, quantity, available_qty, source, invoice_id, recorded_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (invoice_id, variant_id) WHERE invoice_id IS NOT NULL
       DO UPDATE SET quantity = GREATEST(lost_sales.quantity, EXCLUDED.quantity),
                     available_qty = EXCLUDED.available_qty,
                     occurrences = lost_sales.occurrences + 1, last_at = NOW()
       RETURNING *`,
      [variant.product_id, variantId, qty, availableQty, source, invoiceId, userId, note]);
    return row;
  }
  const { rows: [repeat] } = await query(
    `UPDATE lost_sales SET occurrences = occurrences + 1, last_at = NOW()
      WHERE id = (SELECT id FROM lost_sales
                   WHERE variant_id = $1 AND source = $2 AND invoice_id IS NULL
                     AND recorded_by IS NOT DISTINCT FROM $3
                     AND last_at > NOW() - make_interval(mins => $4)
                   ORDER BY last_at DESC LIMIT 1)
      RETURNING *`,
    [variantId, source, userId, REPEAT_WINDOW_MINUTES]);
  if (repeat) return repeat;
  const { rows: [row] } = await query(
    `INSERT INTO lost_sales (product_id, variant_id, quantity, available_qty, source, recorded_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [variant.product_id, variantId, qty, availableQty, source, userId, note]);
  return row;
}

// A sale refused for short stock: record what couldn't be sold, best effort
// (never hides the refusal from the cashier).
async function recordRefusedSale({ invoiceId, shortfalls, userId }) {
  for (const s of shortfalls || []) {
    const missing = Number(s.requested) - Math.max(0, Number(s.available) || 0);
    if (!(missing > 0) || !s.variantId) continue;
    try {
      await record({ variantId: s.variantId, quantity: missing, availableQty: s.available, source: 'sale_refused', invoiceId, userId });
    } catch (_e) {
      // best effort
    }
  }
}

async function list({ startDate, endDate, variantId = null }) {
  const { rows } = await query(
    `SELECT ls.*, p.name AS product_name, v.sku
       FROM lost_sales ls
       JOIN product_variants v ON v.id = ls.variant_id
       LEFT JOIN products p ON p.id = ls.product_id
      WHERE ls.recorded_at::date BETWEEN $1::date AND $2::date
        AND ($3::uuid IS NULL OR ls.variant_id = $3)
      ORDER BY ls.recorded_at DESC`,
    [startDate, endDate, variantId]);
  return rows.map((r) => ({
    id: r.id, variantId: r.variant_id, productId: r.product_id, productName: r.product_name, sku: r.sku,
    quantity: Number(r.quantity), availableQty: r.available_qty == null ? null : Number(r.available_qty),
    source: r.source, invoiceId: r.invoice_id, occurrences: r.occurrences,
    recordedAt: r.recorded_at, lastAt: r.last_at, note: r.note,
  }));
}

module.exports = { record, recordRefusedSale, list, REPEAT_WINDOW_MINUTES };
