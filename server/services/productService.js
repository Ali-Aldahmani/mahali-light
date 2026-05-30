/**
 * productService.js — data-access layer for products, variants and category paths.
 *
 * Responsibility boundary
 * ───────────────────────
 *   This module owns everything between the DB connection and the raw row →
 *   API-shape transformation.  Controllers call these functions; they should
 *   not construct their own product-related queries.
 *
 *   • loadCategoryPath / loadCategoryPathBatch — resolve ancestor chains
 *   • loadVariants / loadVariantsBatch        — fetch variant rows + attributes
 *   • shapeProduct                            — assemble the final API object
 */
'use strict';

const { query } = require('../db/postgres');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripCost(variant, includeCost) {
  if (includeCost) return variant;
  const v = { ...variant };
  delete v.costPrice;
  return v;
}

// ---------------------------------------------------------------------------
// Category path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the full ancestor path for a single category using one recursive CTE.
 *
 * Replaces the old iterative approach that issued up to six sequential queries.
 * Returns { categoryName, path, depth } — path is "Root > Parent > Direct".
 */
async function loadCategoryPath(categoryId) {
  if (!categoryId) return { path: null, depth: 0, categoryName: null };
  const { rows } = await query(
    `WITH RECURSIVE path AS (
       SELECT id, name, parent_id, 1 AS depth
         FROM product_categories WHERE id = $1
       UNION ALL
       SELECT c.id, c.name, c.parent_id, path.depth + 1
         FROM product_categories c
         JOIN path ON c.id = path.parent_id
        WHERE path.depth < 6
     )
     SELECT name FROM path ORDER BY depth DESC`,
    [categoryId],
  );
  if (!rows.length) return { path: null, depth: 0, categoryName: null };
  const parts = rows.map((r) => r.name); // ordered root → direct category
  return {
    categoryName: parts[parts.length - 1],
    path: parts.join(' > ') || null,
    depth: parts.length,
  };
}

/**
 * Resolve category ancestor chains for a set of IDs in a single multi-seed
 * recursive CTE query.
 *
 * Returns Map<categoryId, { categoryName, path, depth }>.
 * Used by list() and search() to avoid a per-row loadCategoryPath() call.
 */
async function loadCategoryPathBatch(categoryIds) {
  const unique = [...new Set(categoryIds.filter(Boolean))];
  if (!unique.length) return new Map();

  // The CTE seeds from ALL requested IDs simultaneously.  Each row carries
  // its origin `category_id` so results can be grouped back by seed.
  const { rows } = await query(
    `WITH RECURSIVE path AS (
       SELECT id AS category_id, name, parent_id, 1 AS depth
         FROM product_categories WHERE id = ANY($1)
       UNION ALL
       SELECT path.category_id, c.name, c.parent_id, path.depth + 1
         FROM product_categories c
         JOIN path ON c.id = path.parent_id
        WHERE path.depth < 6
     )
     SELECT category_id, name FROM path ORDER BY category_id, depth DESC`,
    [unique],
  );

  // GROUP BY category_id; ORDER BY depth DESC → row[0] = root, row[last] = direct
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.category_id)) groups.set(r.category_id, []);
    groups.get(r.category_id).push(r.name);
  }

  const result = new Map();
  for (const [catId, parts] of groups) {
    result.set(catId, {
      categoryName: parts[parts.length - 1],
      path: parts.join(' > ') || null,
      depth: parts.length,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Variant loading
// ---------------------------------------------------------------------------

/**
 * Load all active variants (+ attribute maps) for a single product.
 * Used by getOne, create, update, uploadImage.
 */
async function loadVariants(productId, includeCost) {
  const { rows } = await query(
    `SELECT * FROM product_variants
      WHERE product_id = $1 AND is_active = true
      ORDER BY sku ASC`,
    [productId],
  );

  const variantIds = rows.map((r) => r.id);
  const attrMap = new Map();
  if (variantIds.length) {
    const { rows: links } = await query(
      `SELECT pva.variant_id, av.id AS value_id, av.value, av.sort_order,
              a.id AS attribute_id, a.name AS attribute_name, a.unit
         FROM product_variant_attributes pva
         JOIN product_attribute_values av ON av.id = pva.attribute_value_id
         JOIN product_attributes a ON a.id = av.attribute_id
        WHERE pva.variant_id = ANY($1)
        ORDER BY a.name ASC`,
      [variantIds],
    );
    for (const link of links) {
      if (!attrMap.has(link.variant_id)) attrMap.set(link.variant_id, []);
      attrMap.get(link.variant_id).push({
        attributeId: link.attribute_id,
        attributeName: link.attribute_name,
        unit: link.unit,
        valueId: link.value_id,
        value: link.value,
      });
    }
  }

  return rows.map((r) =>
    stripCost(
      {
        id: r.id,
        productId: r.product_id,
        sku: r.sku,
        barcode: r.barcode,
        supplierBarcode: r.supplier_barcode,
        internalBarcode: r.internal_barcode,
        sellingPrice: Number(r.selling_price),
        costPrice: Number(r.cost_price),
        stockQty: Number(r.stock_qty),
        quarantineQty: Number(r.quarantine_qty),
        reorderThreshold: r.reorder_threshold == null ? null : Number(r.reorder_threshold),
        imagePath: r.image_path,
        isActive: r.is_active,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        attributes: attrMap.get(r.id) || [],
      },
      includeCost,
    ),
  );
}

/**
 * Load variants for a set of product IDs in exactly two queries.
 * Returns Map<productId, variant[]> — same object shape as loadVariants().
 * Used by list() to avoid the per-product N+1 fan-out.
 */
async function loadVariantsBatch(productIds, includeCost) {
  if (!productIds.length) return new Map();

  const { rows } = await query(
    `SELECT * FROM product_variants
      WHERE product_id = ANY($1) AND is_active = true
      ORDER BY product_id, sku ASC`,
    [productIds],
  );

  const variantIds = rows.map((r) => r.id);
  const attrMap = new Map();
  if (variantIds.length) {
    const { rows: links } = await query(
      `SELECT pva.variant_id, av.id AS value_id, av.value, av.sort_order,
              a.id AS attribute_id, a.name AS attribute_name, a.unit
         FROM product_variant_attributes pva
         JOIN product_attribute_values av ON av.id = pva.attribute_value_id
         JOIN product_attributes a ON a.id = av.attribute_id
        WHERE pva.variant_id = ANY($1)
        ORDER BY a.name ASC`,
      [variantIds],
    );
    for (const link of links) {
      if (!attrMap.has(link.variant_id)) attrMap.set(link.variant_id, []);
      attrMap.get(link.variant_id).push({
        attributeId: link.attribute_id,
        attributeName: link.attribute_name,
        unit: link.unit,
        valueId: link.value_id,
        value: link.value,
      });
    }
  }

  const result = new Map();
  for (const r of rows) {
    if (!result.has(r.product_id)) result.set(r.product_id, []);
    result.get(r.product_id).push(
      stripCost(
        {
          id: r.id,
          productId: r.product_id,
          sku: r.sku,
          barcode: r.barcode,
          supplierBarcode: r.supplier_barcode,
          internalBarcode: r.internal_barcode,
          sellingPrice: Number(r.selling_price),
          costPrice: Number(r.cost_price),
          stockQty: Number(r.stock_qty),
          quarantineQty: Number(r.quarantine_qty),
          reorderThreshold: r.reorder_threshold == null ? null : Number(r.reorder_threshold),
          imagePath: r.image_path,
          isActive: r.is_active,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          attributes: attrMap.get(r.id) || [],
        },
        includeCost,
      ),
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Product shaping
// ---------------------------------------------------------------------------

/**
 * Assemble a product API response object from a raw DB row + pre-loaded data.
 *
 * @param {object} row        - Raw row from the `products` table.
 * @param {object} options
 * @param {boolean} options.includeCost  - Whether to expose cost fields.
 * @param {Array}   options.variants     - Pre-loaded variant array (from loadVariants*).
 * @param {boolean} [options.summary]   - Include aggregate stats (variantCount, totalStock…).
 * @param {object}  [options.cat]       - Pre-loaded category path (from loadCategoryPath*).
 *                                        When null the function calls loadCategoryPath()
 *                                        automatically, so single-product callers don't need
 *                                        to pre-fetch separately.
 */
async function shapeProduct(row, { includeCost, variants, summary = false, cat = null }) {
  const catData = cat !== null ? cat : await loadCategoryPath(row.category_id);
  const base = {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    categoryName: catData.categoryName,
    categoryPath: catData.path,
    brand: row.brand,
    imagePath: row.image_path,
    hasVariants: row.has_variants,
    soldBy: row.sold_by,
    unitLabel: row.unit_label,
    defaultWarrantyMonths: row.default_warranty_months,
    reorderThreshold: row.reorder_threshold == null ? null : Number(row.reorder_threshold),
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  base.variants = variants || [];
  if (summary) {
    base.variantCount = variants ? variants.length : 0;
    base.totalStock = variants
      ? variants.reduce((a, v) => a + Number(v.stockQty || 0), 0)
      : 0;
    if (variants && variants.length) {
      const prices = variants.map((v) => Number(v.sellingPrice || 0));
      base.minPrice = Math.min(...prices);
      base.maxPrice = Math.max(...prices);
    }
    if (includeCost && variants && variants.length) {
      base.totalStockValue = variants.reduce(
        (a, v) => a + Number(v.stockQty || 0) * Number(v.costPrice || 0),
        0,
      );
    }
  }
  return base;
}

module.exports = {
  loadCategoryPath,
  loadCategoryPathBatch,
  loadVariants,
  loadVariantsBatch,
  shapeProduct,
};
