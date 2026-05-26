const { query } = require('../db/postgres');
const { ok } = require('../utils/response');

function canSeeCost(req) {
  return (req.user?.permissions || []).includes('product.view_cost');
}

async function lowStock(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { rows } = await query(
      `SELECT v.id AS variant_id, v.product_id, v.sku, v.internal_barcode AS barcode,
              v.stock_qty,
              COALESCE(v.reorder_threshold, p.reorder_threshold, 0) AS threshold,
              v.cost_price,
              p.name AS product_name, p.unit_label, p.image_path AS product_image,
              p.category_id,
              (SELECT name FROM product_categories WHERE id = p.category_id) AS category_name
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true AND p.is_active = true
          AND COALESCE(v.reorder_threshold, p.reorder_threshold, 0) > 0
          AND v.stock_qty <= COALESCE(v.reorder_threshold, p.reorder_threshold)
        ORDER BY (v.stock_qty / GREATEST(COALESCE(v.reorder_threshold, p.reorder_threshold), 1)) ASC
        LIMIT 500`,
    );

    return ok(
      res,
      rows.map((r) => {
        const out = {
          variantId: r.variant_id,
          productId: r.product_id,
          productName: r.product_name,
          productImage: r.product_image,
          sku: r.sku,
          barcode: r.barcode,
          categoryId: r.category_id,
          categoryName: r.category_name,
          stockQty: Number(r.stock_qty),
          threshold: Number(r.threshold),
          unitLabel: r.unit_label,
        };
        if (includeCost) out.costPrice = Number(r.cost_price || 0);
        return out;
      }),
    );
  } catch (err) {
    next(err);
  }
}

async function deadStock(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));

    const { rows } = await query(
      `SELECT v.id AS variant_id, v.product_id, v.sku, v.internal_barcode AS barcode,
              v.stock_qty, v.cost_price,
              p.name AS product_name, p.unit_label, p.image_path AS product_image,
              p.category_id,
              (SELECT name FROM product_categories WHERE id = p.category_id) AS category_name,
              (SELECT MAX(m.timestamp) FROM stock_movements m
                WHERE m.variant_id = v.id
                  AND m.movement_type = 'sale') AS last_sale_at
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true AND p.is_active = true
          AND v.stock_qty > 0
          AND NOT EXISTS (
            SELECT 1 FROM stock_movements m
              WHERE m.variant_id = v.id
                AND m.movement_type = 'sale'
                AND m.timestamp > NOW() - ($1::int * INTERVAL '1 day')
          )
        ORDER BY v.stock_qty * v.cost_price DESC NULLS LAST
        LIMIT 500`,
      [days],
    );

    return ok(
      res,
      rows.map((r) => {
        const out = {
          variantId: r.variant_id,
          productId: r.product_id,
          productName: r.product_name,
          productImage: r.product_image,
          sku: r.sku,
          barcode: r.barcode,
          categoryId: r.category_id,
          categoryName: r.category_name,
          stockQty: Number(r.stock_qty),
          unitLabel: r.unit_label,
          lastSaleAt: r.last_sale_at,
          daysWithoutSale: days,
        };
        if (includeCost) {
          out.costPrice = Number(r.cost_price || 0);
          out.tiedValue = Number(r.stock_qty) * Number(r.cost_price || 0);
        }
        return out;
      }),
      { thresholdDays: days },
    );
  } catch (err) {
    next(err);
  }
}

async function valuation(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    if (!includeCost) {
      // Valuation report fundamentally exposes cost data.
      return ok(res, [], { permissionDenied: true });
    }

    const { rows: perCat } = await query(
      `SELECT c.id AS category_id, c.name AS category_name,
              COUNT(DISTINCT p.id)::int AS product_count,
              COUNT(v.id)::int AS variant_count,
              COALESCE(SUM(v.stock_qty), 0)::numeric AS total_qty,
              COALESCE(SUM(v.stock_qty * v.cost_price), 0)::numeric AS total_value
         FROM product_categories c
         LEFT JOIN products p ON p.category_id = c.id AND p.is_active = true
         LEFT JOIN product_variants v ON v.product_id = p.id AND v.is_active = true
        GROUP BY c.id, c.name
        ORDER BY total_value DESC NULLS LAST`,
    );

    const { rows: totalRows } = await query(
      `SELECT COALESCE(SUM(v.stock_qty * v.cost_price), 0)::numeric AS total_value,
              COUNT(*)::int AS variant_count
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true AND p.is_active = true`,
    );

    return ok(
      res,
      perCat
        .filter((r) => r.variant_count > 0)
        .map((r) => ({
          categoryId: r.category_id,
          categoryName: r.category_name,
          productCount: r.product_count,
          variantCount: r.variant_count,
          totalQty: Number(r.total_qty),
          totalValue: Number(r.total_value),
        })),
      {
        grandTotalValue: Number(totalRows[0].total_value),
        totalVariants: totalRows[0].variant_count,
      },
    );
  } catch (err) {
    next(err);
  }
}

module.exports = { lowStock, deadStock, valuation };
