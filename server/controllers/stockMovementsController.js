const { query } = require('../db/postgres');
const { ok, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

const ALLOWED_TYPES = new Set([
  'sale',
  'purchase',
  'adjustment',
  'count_correction',
  'return_in',
  'return_out',
  'quarantine',
  'quarantine_release',
  'opening_stock',
]);

function canSeeCost(req) {
  return (req.user?.permissions || []).includes('product.view_cost');
}

function shape(row, { includeCost }) {
  const out = {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    movementType: row.movement_type,
    quantity: Number(row.quantity),
    qtyBefore: Number(row.qty_before),
    qtyAfter: Number(row.qty_after),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    unitLabel: row.unit_label,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username,
    timestamp: row.timestamp,
    notes: row.notes,
    productName: row.product_name,
    productImage: row.product_image,
    variantSku: row.variant_sku,
    variantBarcode: row.variant_barcode,
  };
  if (includeCost && row.cost_price != null) {
    out.costPrice = Number(row.cost_price);
    out.valueImpact = Number(row.quantity) * Number(row.cost_price);
  }
  return out;
}

const LIST_SQL = `
  SELECT m.*,
         u.username AS employee_username,
         p.name AS product_name,
         p.image_path AS product_image,
         v.sku AS variant_sku,
         v.internal_barcode AS variant_barcode,
         v.cost_price
    FROM stock_movements m
    LEFT JOIN users u ON u.id = m.employee_id
    LEFT JOIN products p ON p.id = m.product_id
    LEFT JOIN product_variants v ON v.id = m.variant_id
`;

async function list(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [];
    const params = [];

    if (req.query.productId) {
      params.push(req.query.productId);
      where.push(`m.product_id = $${params.length}`);
    }
    if (req.query.variantId) {
      params.push(req.query.variantId);
      where.push(`m.variant_id = $${params.length}`);
    }
    if (req.query.movementType) {
      const types = String(req.query.movementType)
        .split(',')
        .map((t) => t.trim())
        .filter((t) => ALLOWED_TYPES.has(t));
      if (types.length) {
        params.push(types);
        where.push(`m.movement_type = ANY($${params.length})`);
      }
    }
    if (req.query.employeeId) {
      params.push(req.query.employeeId);
      where.push(`m.employee_id = $${params.length}`);
    }
    if (req.query.referenceType) {
      params.push(req.query.referenceType);
      where.push(`m.reference_type = $${params.length}`);
    }
    if (req.query.dateFrom) {
      params.push(req.query.dateFrom);
      where.push(`m.timestamp >= $${params.length}`);
    }
    if (req.query.dateTo) {
      params.push(req.query.dateTo);
      where.push(`m.timestamp <= $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      where.push(
        `(p.name ILIKE $${i} OR v.sku ILIKE $${i} OR v.internal_barcode ILIKE $${i})`,
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM stock_movements m
         LEFT JOIN products p ON p.id = m.product_id
         LEFT JOIN product_variants v ON v.id = m.variant_id
        ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `${LIST_SQL}
       ${whereSql}
       ORDER BY m.timestamp DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return ok(
      res,
      rows.map((r) => shape(r, { includeCost })),
      {
        page,
        limit,
        total: countRows[0].total,
      },
    );
  } catch (err) {
    next(err);
  }
}

async function listForProduct(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { productId } = req.params;
    const limit = Math.min(200, Number(req.query.limit) || 100);

    const params = [productId];
    let typeClause = '';
    if (req.query.movementType) {
      const types = String(req.query.movementType)
        .split(',')
        .map((t) => t.trim())
        .filter((t) => ALLOWED_TYPES.has(t));
      if (types.length) {
        params.push(types);
        typeClause = `AND m.movement_type = ANY($${params.length})`;
      }
    }
    params.push(limit);

    const { rows } = await query(
      `${LIST_SQL}
        WHERE m.product_id = $1 ${typeClause}
        ORDER BY m.timestamp DESC
        LIMIT $${params.length}`,
      params,
    );
    return ok(
      res,
      rows.map((r) => shape(r, { includeCost })),
    );
  } catch (err) {
    next(err);
  }
}

async function listForVariant(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { variantId } = req.params;
    const limit = Math.min(200, Number(req.query.limit) || 100);

    const { rows } = await query(
      `${LIST_SQL}
        WHERE m.variant_id = $1
        ORDER BY m.timestamp DESC
        LIMIT $2`,
      [variantId, limit],
    );
    return ok(
      res,
      rows.map((r) => shape(r, { includeCost })),
    );
  } catch (err) {
    next(err);
  }
}

// Current stock summary across all active variants — used by /inventory.
async function summary(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 25 });

    const where = [`p.is_active = true`, `v.is_active = true`];
    const params = [];

    if (req.query.categoryId) {
      params.push(req.query.categoryId);
      where.push(`p.category_id IN (
        WITH RECURSIVE t AS (
          SELECT id FROM product_categories WHERE id = $${params.length}
          UNION ALL
          SELECT c.id FROM product_categories c JOIN t ON c.parent_id = t.id
        )
        SELECT id FROM t
      )`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const i = params.length;
      where.push(
        `(p.name ILIKE $${i} OR v.sku ILIKE $${i} OR v.internal_barcode ILIKE $${i} OR v.barcode ILIKE $${i})`,
      );
    }
    // status filter: in_stock / low_stock / out_of_stock / quarantine / all
    const status = req.query.status || 'all';
    if (status === 'out_of_stock') {
      where.push(`v.stock_qty <= 0`);
    } else if (status === 'low_stock') {
      where.push(
        `v.stock_qty > 0 AND COALESCE(v.reorder_threshold, p.reorder_threshold, 0) > 0
         AND v.stock_qty <= COALESCE(v.reorder_threshold, p.reorder_threshold)`,
      );
    } else if (status === 'in_stock') {
      where.push(
        `v.stock_qty > COALESCE(NULLIF(v.reorder_threshold, 0), NULLIF(p.reorder_threshold, 0), 0)`,
      );
    } else if (status === 'quarantine') {
      where.push(`v.quarantine_qty > 0`);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT v.id AS variant_id, v.product_id, v.sku, v.barcode, v.internal_barcode,
              v.stock_qty, v.quarantine_qty, v.reorder_threshold AS variant_threshold,
              v.cost_price, v.selling_price, v.image_path AS variant_image,
              p.name AS product_name, p.image_path AS product_image,
              p.unit_label, p.sold_by, p.reorder_threshold AS product_threshold,
              p.category_id,
              (SELECT name FROM product_categories WHERE id = p.category_id) AS category_name
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        ${whereSql}
        ORDER BY p.name ASC, v.sku ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const data = rows.map((r) => {
      const threshold = Number(
        r.variant_threshold != null ? r.variant_threshold : r.product_threshold || 0,
      );
      const qty = Number(r.stock_qty);
      const qq = Number(r.quarantine_qty || 0);
      const status =
        qty <= 0
          ? 'out_of_stock'
          : threshold > 0 && qty <= threshold
            ? 'low_stock'
            : 'in_stock';

      const out = {
        variantId: r.variant_id,
        productId: r.product_id,
        productName: r.product_name,
        productImage: r.variant_image || r.product_image,
        sku: r.sku,
        barcode: r.internal_barcode || r.barcode,
        categoryId: r.category_id,
        categoryName: r.category_name,
        stockQty: qty,
        quarantineQty: qq,
        reorderThreshold: threshold,
        unitLabel: r.unit_label,
        soldBy: r.sold_by,
        status,
        sellingPrice: Number(r.selling_price || 0),
      };
      if (includeCost) {
        out.costPrice = Number(r.cost_price || 0);
        out.stockValue = qty * Number(r.cost_price || 0);
      }
      return out;
    });

    // Roll-up counters for the summary cards in the UI.
    let totals;
    if (page === 1 || req.query.includeTotals === '1') {
      const { rows: totalsRows } = await query(
        `SELECT
            COUNT(*)::int AS total_products,
            COUNT(*) FILTER (WHERE v.stock_qty <= 0)::int AS out_of_stock,
            COUNT(*) FILTER (
              WHERE v.stock_qty > 0
                AND COALESCE(v.reorder_threshold, p.reorder_threshold, 0) > 0
                AND v.stock_qty <= COALESCE(v.reorder_threshold, p.reorder_threshold)
            )::int AS low_stock,
            COUNT(*) FILTER (WHERE v.quarantine_qty > 0)::int AS in_quarantine,
            COALESCE(SUM(v.stock_qty * v.cost_price), 0)::numeric AS total_value
           FROM product_variants v
           JOIN products p ON p.id = v.product_id
          WHERE p.is_active = true AND v.is_active = true`,
      );
      totals = totalsRows[0];
      if (!includeCost) totals.total_value = null;
    }

    return ok(res, data, {
      page,
      limit,
      total: countRows[0].total,
      totals: totals
        ? {
            totalProducts: totals.total_products,
            outOfStock: totals.out_of_stock,
            lowStock: totals.low_stock,
            inQuarantine: totals.in_quarantine,
            totalValueAtCost:
              totals.total_value == null ? null : Number(totals.total_value),
          }
        : undefined,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, listForProduct, listForVariant, summary };
