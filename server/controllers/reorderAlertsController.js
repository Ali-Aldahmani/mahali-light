const { query } = require('../db/postgres');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { checkReorderThreshold } = require('../services/reorderService');

function shape(row) {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    currentStock: Number(row.current_stock),
    reorderPoint: Number(row.reorder_point),
    recommendedOrderQty: Number(row.recommended_order_qty),
    suggestedSupplierId: row.suggested_supplier_id,
    status: row.status,
    createdAt: row.created_at,
    dismissedBy: row.dismissed_by,
    dismissedByUsername: row.dismissed_by_username,
    dismissedAt: row.dismissed_at,
    productName: row.product_name,
    productImage: row.product_image,
    unitLabel: row.unit_label,
    categoryName: row.category_name,
    sku: row.sku,
    barcode: row.barcode,
  };
}

const LIST_SQL = `
  SELECT a.*,
         dis.username AS dismissed_by_username,
         p.name AS product_name,
         p.image_path AS product_image,
         p.unit_label,
         v.sku, v.internal_barcode AS barcode,
         (SELECT name FROM product_categories WHERE id = p.category_id) AS category_name
    FROM reorder_alerts a
    LEFT JOIN users dis ON dis.id = a.dismissed_by
    LEFT JOIN products p ON p.id = a.product_id
    LEFT JOIN product_variants v ON v.id = a.variant_id
`;

async function list(req, res, next) {
  try {
    const status = req.query.status || 'pending';
    const where = [];
    const params = [];

    if (status !== 'all') {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await query(
      `${LIST_SQL}
       ${whereSql}
       ORDER BY a.created_at DESC
       LIMIT 500`,
      params,
    );

    const { rows: counts } = await query(
      `SELECT COUNT(*)::int AS pending FROM reorder_alerts WHERE status = 'pending'`,
    );

    return ok(res, rows.map(shape), { pendingCount: counts[0].pending });
  } catch (err) {
    next(err);
  }
}

async function dismiss(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id, status FROM reorder_alerts WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].status !== 'pending') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        `Alert already ${rows[0].status}.`,
        { status: 409 },
      );
    }

    await query(
      `UPDATE reorder_alerts
          SET status = 'dismissed',
              dismissed_by = $1,
              dismissed_at = NOW()
        WHERE id = $2`,
      [req.user.id, id],
    );

    await logActivity({
      entityType: 'reorder_alert',
      entityId: id,
      action: 'stock.reorder_alert_dismissed',
      performedBy: req.user.id,
    });

    const { rows: full } = await query(`${LIST_SQL} WHERE a.id = $1`, [id]);
    return ok(res, shape(full[0]));
  } catch (err) {
    next(err);
  }
}

// Re-evaluate alerts across all active variants (manual trigger).
async function checkAll(req, res, next) {
  try {
    const { rows: variants } = await query(
      `SELECT v.id FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true AND p.is_active = true`,
    );

    let created = 0;
    let resolved = 0;
    for (const v of variants) {
      const r = await checkReorderThreshold(v.id);
      if (r?.created) created++;
      if (r?.resolved) resolved += r.resolved;
    }

    return ok(res, { scanned: variants.length, created, resolved });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, dismiss, checkAll };
