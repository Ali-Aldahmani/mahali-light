const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  generateUniqueInternalBarcode,
  generateUniqueSku,
} = require('../utils/sku');
const {
  saveProductImage,
  deleteImageFile,
} = require('../utils/upload');
const { applyStockMovement } = require('../services/stockService');
const {
  loadCategoryPath,
  loadCategoryPathBatch,
  loadVariants,
  loadVariantsBatch,
  shapeProduct,
} = require('../services/productService');

const SOLD_BY = ['piece', 'meter', 'roll', 'kg', 'box'];

const baseProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brand: z.string().max(100).nullable().optional(),
  hasVariants: z.boolean().optional().default(false),
  soldBy: z.enum(SOLD_BY).optional().default('piece'),
  unitLabel: z.string().max(20).optional().default('pcs'),
  defaultWarrantyMonths: z.number().int().min(0).max(120).optional().default(0),
  reorderThreshold: z.number().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

const simpleVariantSchema = z.object({
  sku: z.string().max(100).optional().nullable(),
  barcode: z.string().max(100).optional().nullable(),
  supplierBarcode: z.string().max(100).optional().nullable(),
  sellingPrice: z.number().min(0).default(0),
  costPrice: z.number().min(0).default(0),
  openingStock: z.number().min(0).default(0),
  reorderThreshold: z.number().min(0).nullable().optional(),
});

const variantInputSchema = z.object({
  attributeValueIds: z.array(z.string().uuid()).default([]),
  sku: z.string().max(100).optional().nullable(),
  barcode: z.string().max(100).optional().nullable(),
  supplierBarcode: z.string().max(100).optional().nullable(),
  sellingPrice: z.number().min(0).default(0),
  costPrice: z.number().min(0).default(0),
  openingStock: z.number().min(0).default(0),
  reorderThreshold: z.number().min(0).nullable().optional(),
});

const createSchema = baseProductSchema.extend({
  simple: simpleVariantSchema.nullable().optional(),
  variants: z.array(variantInputSchema).optional().default([]),
});

const updateSchema = baseProductSchema.partial();

// Whether to expose cost_price in API responses for this request.
function canSeeCost(req) {
  const owned = new Set(req.user?.permissions || []);
  return owned.has('product.view_cost');
}

// ---------- list ----------

async function list(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { page, limit, offset } = parsePagination(req);
    const search = (req.query.search || '').toString().trim();

    const where = [];
    const params = [];

    if (req.query.isActive !== 'all') {
      const active = req.query.isActive === 'false' ? false : true;
      params.push(active);
      where.push(`p.is_active = $${params.length}`);
    }
    if (req.query.categoryId) {
      // Include the requested category and any descendant.
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
    if (req.query.soldBy && SOLD_BY.includes(req.query.soldBy)) {
      params.push(req.query.soldBy);
      where.push(`p.sold_by = $${params.length}`);
    }
    if (req.query.hasVariants === 'true' || req.query.hasVariants === 'false') {
      params.push(req.query.hasVariants === 'true');
      where.push(`p.has_variants = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      where.push(
        `(p.name ILIKE $${i} OR p.brand ILIKE $${i}
          OR EXISTS (SELECT 1 FROM product_variants v
                      WHERE v.product_id = p.id
                        AND (v.sku ILIKE $${i}
                          OR v.barcode ILIKE $${i}
                          OR v.internal_barcode ILIKE $${i}
                          OR v.supplier_barcode ILIKE $${i})))`,
      );
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::int AS total FROM products p ${whereSql}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT p.* FROM products p ${whereSql}
       ORDER BY p.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Batch-load variants and category paths for the whole page in parallel —
    // 2 queries total instead of up to 800+ for a 100-product page.
    const [variantsByProduct, catPathByCategory] = await Promise.all([
      loadVariantsBatch(rows.map((r) => r.id), includeCost),
      loadCategoryPathBatch(rows.map((r) => r.category_id)),
    ]);

    const data = await Promise.all(
      rows.map((row) => {
        const variants = variantsByProduct.get(row.id) || [];
        const cat = catPathByCategory.get(row.category_id)
          || { path: null, depth: 0, categoryName: null };
        return shapeProduct(row, { includeCost, variants, summary: true, cat });
      }),
    );

    return ok(res, data, {
      page,
      limit,
      total: countRows[0].total,
    });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { rows } = await query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const variants = await loadVariants(rows[0].id, includeCost);
    return ok(res, await shapeProduct(rows[0], { includeCost, variants }));
  } catch (err) {
    next(err);
  }
}

// ---------- create ----------

async function ensureUniqueSku(client, sku) {
  const { rows } = await client.query(
    `SELECT id FROM product_variants WHERE sku = $1 LIMIT 1`,
    [sku],
  );
  if (rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_CONFLICT, `SKU ${sku} is already in use.`, {
      status: 409,
      details: { field: 'sku', value: sku },
    });
  }
}

async function ensureUniqueInternalBarcode(client, value) {
  if (!value) return;
  const { rows } = await client.query(
    `SELECT id FROM product_variants WHERE internal_barcode = $1 LIMIT 1`,
    [value],
  );
  if (rows.length) {
    throw new AppError(
      ERROR_CODES.RESOURCE_CONFLICT,
      `Barcode ${value} is already in use.`,
      { status: 409, details: { field: 'barcode', value } },
    );
  }
}

async function insertVariant(client, {
  productId,
  variant,
  categoryId,
  brand,
  employeeId = null,
}) {
  // SKU: caller-provided or generated.
  let sku = variant.sku ? variant.sku.trim() : null;
  if (!sku) sku = await generateUniqueSku({ categoryId, brand });
  await ensureUniqueSku(client, sku);

  // Internal barcode = primary barcode if not provided.
  let internalBarcode = variant.barcode ? variant.barcode.trim() : null;
  if (!internalBarcode)
    internalBarcode = await generateUniqueInternalBarcode(categoryId);
  await ensureUniqueInternalBarcode(client, internalBarcode);

  const supplierBarcode = variant.supplierBarcode
    ? variant.supplierBarcode.trim()
    : null;
  const displayBarcode = internalBarcode;

  // Variant is created with zero stock; opening stock is then applied as a
  // proper stock movement so the audit trail is complete.
  const { rows } = await client.query(
    `INSERT INTO product_variants
       (product_id, sku, supplier_barcode, internal_barcode, barcode,
        selling_price, cost_price, stock_qty, reorder_threshold, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,true)
     RETURNING id`,
    [
      productId,
      sku,
      supplierBarcode,
      internalBarcode,
      displayBarcode,
      variant.sellingPrice || 0,
      variant.costPrice || 0,
      variant.reorderThreshold ?? null,
    ],
  );

  const variantId = rows[0].id;

  if (variant.attributeValueIds && variant.attributeValueIds.length) {
    for (const valId of variant.attributeValueIds) {
      await client.query(
        `INSERT INTO product_variant_attributes (variant_id, attribute_value_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [variantId, valId],
      );
    }
  }

  const opening = Number(variant.openingStock || 0);
  if (opening > 0) {
    await applyStockMovement({
      client,
      variantId,
      productId,
      type: 'opening_stock',
      quantity: opening,
      employeeId,
      notes: 'Opening stock at product creation',
      skipReorderCheck: true,
    });
  }

  return variantId;
}

async function create(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const body = createSchema.parse(req.body || {});

    if (body.hasVariants && (!body.variants || !body.variants.length)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Variant products must include at least one variant.',
        { status: 400 },
      );
    }
    if (!body.hasVariants && !body.simple) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Simple products must include pricing details.',
        { status: 400 },
      );
    }

    const productId = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO products
           (name, description, category_id, brand,
            has_variants, sold_by, unit_label,
            default_warranty_months, reorder_threshold,
            is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          body.name,
          body.description || null,
          body.categoryId || null,
          body.brand || null,
          !!body.hasVariants,
          body.soldBy || 'piece',
          body.unitLabel || 'pcs',
          body.defaultWarrantyMonths || 0,
          body.reorderThreshold || 0,
          body.isActive ?? true,
          req.user.id,
        ],
      );
      const id = rows[0].id;

      if (body.hasVariants) {
        for (const v of body.variants) {
          await insertVariant(client, {
            productId: id,
            variant: v,
            categoryId: body.categoryId,
            brand: body.brand,
            employeeId: req.user.id,
          });
        }
      } else {
        await insertVariant(client, {
          productId: id,
          variant: {
            attributeValueIds: [],
            sku: body.simple.sku,
            barcode: body.simple.barcode,
            supplierBarcode: body.simple.supplierBarcode,
            sellingPrice: body.simple.sellingPrice,
            costPrice: body.simple.costPrice,
            openingStock: body.simple.openingStock,
            reorderThreshold: body.simple.reorderThreshold,
          },
          categoryId: body.categoryId,
          brand: body.brand,
          employeeId: req.user.id,
        });
      }
      return id;
    });

    const { rows } = await query(`SELECT * FROM products WHERE id = $1`, [productId]);
    const variants = await loadVariants(productId, includeCost);
    const shaped = await shapeProduct(rows[0], { includeCost, variants });

    await logActivity({
      entityType: 'product',
      entityId: productId,
      action: 'product.created',
      performedBy: req.user.id,
      newValue: { name: body.name, hasVariants: !!body.hasVariants, variantCount: variants.length },
    });

    emitProductChange(req, 'product_updated', { id: productId, action: 'created' });
    return created(res, shaped);
  } catch (err) {
    next(err);
  }
}

// ---------- update ----------

async function update(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;
    const body = updateSchema.parse(req.body || {});

    const { rows: existing } = await query(`SELECT * FROM products WHERE id = $1`, [id]);
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const map = {
      name: 'name',
      description: 'description',
      categoryId: 'category_id',
      brand: 'brand',
      hasVariants: 'has_variants',
      soldBy: 'sold_by',
      unitLabel: 'unit_label',
      defaultWarrantyMonths: 'default_warranty_months',
      reorderThreshold: 'reorder_threshold',
      isActive: 'is_active',
    };
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(map)) {
      if (body[key] !== undefined) {
        params.push(body[key] === '' ? null : body[key]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length) {
      sets.push('updated_at = NOW()');
      params.push(id);
      await query(
        `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
    }

    await logActivity({
      entityType: 'product',
      entityId: id,
      action: 'product.updated',
      performedBy: req.user.id,
      oldValue: { name: existing[0].name },
      newValue: body,
    });

    const { rows } = await query(`SELECT * FROM products WHERE id = $1`, [id]);
    const variants = await loadVariants(id, includeCost);
    const shaped = await shapeProduct(rows[0], { includeCost, variants });

    emitProductChange(req, 'product_updated', { id, action: 'updated' });
    return ok(res, shaped);
  } catch (err) {
    next(err);
  }
}

// ---------- delete ----------

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const { rows: existing } = await query(
      `SELECT id, is_active FROM products WHERE id = $1`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    // Soft delete (also for safety once invoices reference these in Phase 2+).
    await query(
      `UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    );

    await logActivity({
      entityType: 'product',
      entityId: id,
      action: 'product.deleted',
      performedBy: req.user.id,
    });

    emitProductChange(req, 'product_updated', { id, action: 'deleted' });
    return ok(res, { id, deleted: true });
  } catch (err) {
    next(err);
  }
}

// ---------- image ----------

async function uploadImage(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;

    const { rows } = await query(`SELECT * FROM products WHERE id = $1`, [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const relPath = await saveProductImage({
      productId: id,
      file: req.file,
      replacePath: rows[0].image_path,
      suffix: 'product',
    });

    await query(
      `UPDATE products SET image_path = $1, updated_at = NOW() WHERE id = $2`,
      [relPath, id],
    );

    await logActivity({
      entityType: 'product',
      entityId: id,
      action: 'product.image_updated',
      performedBy: req.user.id,
      newValue: { imagePath: relPath },
    });

    const { rows: refreshed } = await query(`SELECT * FROM products WHERE id = $1`, [id]);
    const variants = await loadVariants(id, includeCost);
    emitProductChange(req, 'product_updated', { id, action: 'image_updated' });
    return ok(res, await shapeProduct(refreshed[0], { includeCost, variants }));
  } catch (err) {
    next(err);
  }
}

async function deleteImage(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(`SELECT image_path FROM products WHERE id = $1`, [id]);
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].image_path) deleteImageFile(rows[0].image_path);
    await query(
      `UPDATE products SET image_path = NULL, updated_at = NOW() WHERE id = $1`,
      [id],
    );

    await logActivity({
      entityType: 'product',
      entityId: id,
      action: 'product.image_updated',
      performedBy: req.user.id,
      newValue: { imagePath: null },
    });

    emitProductChange(req, 'product_updated', { id, action: 'image_removed' });
    return ok(res, { id, imagePath: null });
  } catch (err) {
    next(err);
  }
}

// ---------- history ----------

async function history(req, res, next) {
  try {
    const { id } = req.params;
    const { rows: prod } = await query(`SELECT id FROM products WHERE id = $1`, [id]);
    if (!prod.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const { rows: variantRows } = await query(
      `SELECT id FROM product_variants WHERE product_id = $1`,
      [id],
    );
    const ids = [id, ...variantRows.map((v) => v.id)];

    const { rows } = await query(
      `SELECT a.*, u.username AS performed_by_username
         FROM activity_log a
         LEFT JOIN users u ON u.id = a.performed_by
        WHERE (a.entity_type = 'product' AND a.entity_id = ANY($1))
           OR (a.entity_type = 'variant' AND a.entity_id = ANY($1))
        ORDER BY a.timestamp DESC
        LIMIT 200`,
      [ids],
    );

    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        action: r.action,
        performedBy: r.performed_by,
        performedByUsername: r.performed_by_username,
        timestamp: r.timestamp,
        oldValue: r.old_value,
        newValue: r.new_value,
        notes: r.notes,
      })),
    );
  } catch (err) {
    next(err);
  }
}

function emitProductChange(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.emit(event, payload);
}

// ---------- search (used by POS in later phase) ----------

async function search(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const q = (req.query.q || '').toString().trim();
    const categoryId = (req.query.categoryId || '').toString().trim() || null;
    const limit = Math.min(100, Number(req.query.limit) || 25);

    // Empty query is treated as "browse" for the POS — return the most
    // recently-updated active variants, optionally filtered by category.
    const term = q ? `%${q}%` : null;
    const filters = [`v.is_active = true`, `p.is_active = true`];
    const params = [];
    if (term) {
      params.push(term);
      const i = params.length;
      filters.push(`(
        v.sku ILIKE $${i} OR v.barcode ILIKE $${i}
        OR v.internal_barcode ILIKE $${i} OR v.supplier_barcode ILIKE $${i}
        OR p.name ILIKE $${i} OR p.brand ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM product_variant_attributes pva
            JOIN product_attribute_values av ON av.id = pva.attribute_value_id
            JOIN product_attributes a ON a.id = av.attribute_id
          WHERE pva.variant_id = v.id
            AND (av.value ILIKE $${i} OR a.name ILIKE $${i})
        )
      )`);
    }
    if (categoryId) {
      params.push(categoryId);
      filters.push(`p.category_id = $${params.length}`);
    }
    params.push(limit);

    const { rows } = await query(
      `SELECT v.*, p.name AS product_name, p.brand, p.image_path AS product_image,
              p.sold_by, p.unit_label, p.has_variants, p.category_id,
              p.is_active AS product_active,
              p.default_warranty_months,
              c.requires_serial AS category_requires_serial
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE ${filters.join(' AND ')}
        ORDER BY p.name ASC, v.sku ASC
        LIMIT $${params.length}`,
      params,
    );

    const variantIds = rows.map((r) => r.id);
    let attrMap = new Map();
    if (variantIds.length) {
      const { rows: links } = await query(
        `SELECT pva.variant_id, a.id AS attribute_id, a.name AS attribute_name,
                a.unit, av.value
           FROM product_variant_attributes pva
           JOIN product_attribute_values av ON av.id = pva.attribute_value_id
           JOIN product_attributes a ON a.id = av.attribute_id
          WHERE pva.variant_id = ANY($1)`,
        [variantIds],
      );
      for (const l of links) {
        if (!attrMap.has(l.variant_id)) attrMap.set(l.variant_id, []);
        attrMap.get(l.variant_id).push({
          attributeId: l.attribute_id,
          attributeName: l.attribute_name,
          unit: l.unit,
          value: l.value,
        });
      }
    }

    // Resolve category paths for all result rows in one query instead of N.
    const catPathByCategory = await loadCategoryPathBatch(
      rows.map((r) => r.category_id),
    );

    const data = rows.map((r) => {
      const cat = catPathByCategory.get(r.category_id)
        || { path: null, depth: 0, categoryName: null };
      const out = {
        variantId: r.id,
        productId: r.product_id,
        productName: r.product_name,
        brand: r.brand,
        categoryPath: cat.path,
        sku: r.sku,
        barcode: r.barcode,
        supplierBarcode: r.supplier_barcode,
        internalBarcode: r.internal_barcode,
        sellingPrice: Number(r.selling_price),
        stockQty: Number(r.stock_qty),
        soldBy: r.sold_by,
        unitLabel: r.unit_label,
        hasVariants: r.has_variants,
        imagePath: r.image_path || r.product_image,
        attributes: attrMap.get(r.id) || [],
        requiresSerial: !!r.category_requires_serial,
        defaultWarrantyMonths: Number(r.default_warranty_months || 0),
      };
      if (includeCost) out.costPrice = Number(r.cost_price);
      return out;
    });

    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  create,
  update,
  remove,
  uploadImage,
  deleteImage,
  history,
  search,
  emitProductChange,
};
