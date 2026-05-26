const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  generateUniqueInternalBarcode,
  generateUniqueSku,
} = require('../utils/sku');
const { saveProductImage, deleteImageFile } = require('../utils/upload');
const { emitProductChange } = require('./productsController');
const { applyStockMovement } = require('../services/stockService');

const createSchema = z.object({
  attributeValueIds: z.array(z.string().uuid()).default([]),
  sku: z.string().max(100).nullable().optional(),
  barcode: z.string().max(100).nullable().optional(),
  supplierBarcode: z.string().max(100).nullable().optional(),
  sellingPrice: z.number().min(0).default(0),
  costPrice: z.number().min(0).default(0),
  openingStock: z.number().min(0).default(0),
  reorderThreshold: z.number().min(0).nullable().optional(),
});

const updateSchema = z.object({
  attributeValueIds: z.array(z.string().uuid()).optional(),
  sku: z.string().max(100).optional(),
  barcode: z.string().max(100).nullable().optional(),
  supplierBarcode: z.string().max(100).nullable().optional(),
  sellingPrice: z.number().min(0).optional(),
  costPrice: z.number().min(0).optional(),
  reorderThreshold: z.number().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});

function canSeeCost(req) {
  return (req.user?.permissions || []).includes('product.view_cost');
}

function stripCost(v, includeCost) {
  if (includeCost) return v;
  const copy = { ...v };
  delete copy.costPrice;
  return copy;
}

async function loadVariantWithAttributes(variantId, includeCost) {
  const { rows } = await query(
    `SELECT * FROM product_variants WHERE id = $1`,
    [variantId],
  );
  if (!rows.length) return null;
  const r = rows[0];

  const { rows: links } = await query(
    `SELECT av.id AS value_id, av.value, av.sort_order,
            a.id AS attribute_id, a.name AS attribute_name, a.unit
       FROM product_variant_attributes pva
       JOIN product_attribute_values av ON av.id = pva.attribute_value_id
       JOIN product_attributes a ON a.id = av.attribute_id
      WHERE pva.variant_id = $1
      ORDER BY a.name ASC`,
    [variantId],
  );

  return stripCost(
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
      attributes: links.map((l) => ({
        attributeId: l.attribute_id,
        attributeName: l.attribute_name,
        unit: l.unit,
        valueId: l.value_id,
        value: l.value,
      })),
    },
    includeCost,
  );
}

async function list(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;
    const { rows } = await query(
      `SELECT id FROM product_variants
        WHERE product_id = $1 AND is_active = true
        ORDER BY sku ASC`,
      [id],
    );
    const data = await Promise.all(
      rows.map((r) => loadVariantWithAttributes(r.id, includeCost)),
    );
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id } = req.params;
    const body = createSchema.parse(req.body || {});

    const { rows: prod } = await query(
      `SELECT id, category_id, brand FROM products WHERE id = $1`,
      [id],
    );
    if (!prod.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const { category_id: categoryId, brand } = prod[0];

    let sku = body.sku ? body.sku.trim() : null;
    if (!sku) sku = await generateUniqueSku({ categoryId, brand });
    let internalBarcode = body.barcode ? body.barcode.trim() : null;
    if (!internalBarcode)
      internalBarcode = await generateUniqueInternalBarcode(categoryId);

    const variantId = await withTransaction(async (client) => {
      const { rows: dupSku } = await client.query(
        `SELECT id FROM product_variants WHERE sku = $1`,
        [sku],
      );
      if (dupSku.length) {
        throw new AppError(
          ERROR_CODES.RESOURCE_CONFLICT,
          `SKU ${sku} is already in use.`,
          { status: 409, details: { field: 'sku', value: sku } },
        );
      }
      const { rows: dupBc } = await client.query(
        `SELECT id FROM product_variants WHERE internal_barcode = $1`,
        [internalBarcode],
      );
      if (dupBc.length) {
        throw new AppError(
          ERROR_CODES.RESOURCE_CONFLICT,
          `Barcode ${internalBarcode} is already in use.`,
          { status: 409, details: { field: 'barcode', value: internalBarcode } },
        );
      }

      const { rows } = await client.query(
        `INSERT INTO product_variants
           (product_id, sku, supplier_barcode, internal_barcode, barcode,
            selling_price, cost_price, stock_qty, reorder_threshold, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,true)
         RETURNING id`,
        [
          id,
          sku,
          body.supplierBarcode || null,
          internalBarcode,
          internalBarcode,
          body.sellingPrice || 0,
          body.costPrice || 0,
          body.reorderThreshold ?? null,
        ],
      );

      for (const valId of body.attributeValueIds || []) {
        await client.query(
          `INSERT INTO product_variant_attributes (variant_id, attribute_value_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [rows[0].id, valId],
        );
      }

      const opening = Number(body.openingStock || 0);
      if (opening > 0) {
        await applyStockMovement({
          client,
          variantId: rows[0].id,
          productId: id,
          type: 'opening_stock',
          quantity: opening,
          employeeId: req.user.id,
          notes: 'Opening stock at variant creation',
          skipReorderCheck: true,
        });
      }
      return rows[0].id;
    });

    const variant = await loadVariantWithAttributes(variantId, includeCost);
    await logActivity({
      entityType: 'variant',
      entityId: variantId,
      action: 'variant.created',
      performedBy: req.user.id,
      newValue: { productId: id, sku, internalBarcode },
    });
    emitProductChange(req, 'product_updated', { id, action: 'variant_created', variantId });
    return created(res, variant);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id, vid } = req.params;
    const body = updateSchema.parse(req.body || {});

    const { rows: existing } = await query(
      `SELECT * FROM product_variants WHERE id = $1 AND product_id = $2`,
      [vid, id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await withTransaction(async (client) => {
      if (body.sku && body.sku !== existing[0].sku) {
        const { rows: dup } = await client.query(
          `SELECT id FROM product_variants WHERE sku = $1 AND id <> $2`,
          [body.sku, vid],
        );
        if (dup.length) {
          throw new AppError(
            ERROR_CODES.RESOURCE_CONFLICT,
            `SKU ${body.sku} is already in use.`,
            { status: 409, details: { field: 'sku' } },
          );
        }
      }
      if (body.barcode !== undefined && body.barcode !== existing[0].internal_barcode) {
        if (body.barcode) {
          const { rows: dup } = await client.query(
            `SELECT id FROM product_variants WHERE internal_barcode = $1 AND id <> $2`,
            [body.barcode, vid],
          );
          if (dup.length) {
            throw new AppError(
              ERROR_CODES.RESOURCE_CONFLICT,
              `Barcode ${body.barcode} is already in use.`,
              { status: 409, details: { field: 'barcode' } },
            );
          }
        }
      }

      const map = {
        sku: 'sku',
        supplierBarcode: 'supplier_barcode',
        sellingPrice: 'selling_price',
        costPrice: 'cost_price',
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
      if (body.barcode !== undefined) {
        params.push(body.barcode || null);
        sets.push(`internal_barcode = $${params.length}`);
        params.push(body.barcode || null);
        sets.push(`barcode = $${params.length}`);
      }
      if (sets.length) {
        sets.push('updated_at = NOW()');
        params.push(vid);
        await client.query(
          `UPDATE product_variants SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params,
        );
      }

      if (body.attributeValueIds) {
        await client.query(
          `DELETE FROM product_variant_attributes WHERE variant_id = $1`,
          [vid],
        );
        for (const valId of body.attributeValueIds) {
          await client.query(
            `INSERT INTO product_variant_attributes (variant_id, attribute_value_id)
             VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [vid, valId],
          );
        }
      }
    });

    const variant = await loadVariantWithAttributes(vid, includeCost);
    await logActivity({
      entityType: 'variant',
      entityId: vid,
      action: 'variant.updated',
      performedBy: req.user.id,
      newValue: body,
    });
    emitProductChange(req, 'product_updated', { id, action: 'variant_updated', variantId: vid });
    return ok(res, variant);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id, vid } = req.params;
    const { rowCount } = await query(
      `UPDATE product_variants SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND product_id = $2`,
      [vid, id],
    );
    if (!rowCount) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    await logActivity({
      entityType: 'variant',
      entityId: vid,
      action: 'variant.deleted',
      performedBy: req.user.id,
    });
    emitProductChange(req, 'product_updated', { id, action: 'variant_deleted', variantId: vid });
    return ok(res, { id: vid, deleted: true });
  } catch (err) {
    next(err);
  }
}

async function uploadImage(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id, vid } = req.params;

    const { rows } = await query(
      `SELECT * FROM product_variants WHERE id = $1 AND product_id = $2`,
      [vid, id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    const relPath = await saveProductImage({
      productId: id,
      file: req.file,
      replacePath: rows[0].image_path,
      suffix: `variant-${vid.slice(0, 6)}`,
    });

    await query(
      `UPDATE product_variants SET image_path = $1, updated_at = NOW() WHERE id = $2`,
      [relPath, vid],
    );

    await logActivity({
      entityType: 'variant',
      entityId: vid,
      action: 'variant.image_updated',
      performedBy: req.user.id,
      newValue: { imagePath: relPath },
    });

    emitProductChange(req, 'product_updated', { id, action: 'variant_image_updated', variantId: vid });
    return ok(res, await loadVariantWithAttributes(vid, includeCost));
  } catch (err) {
    next(err);
  }
}

async function deleteVariantImage(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { id, vid } = req.params;
    const { rows } = await query(
      `SELECT image_path FROM product_variants WHERE id = $1 AND product_id = $2`,
      [vid, id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].image_path) deleteImageFile(rows[0].image_path);
    await query(
      `UPDATE product_variants SET image_path = NULL, updated_at = NOW() WHERE id = $1`,
      [vid],
    );
    emitProductChange(req, 'product_updated', { id, action: 'variant_image_removed', variantId: vid });
    return ok(res, await loadVariantWithAttributes(vid, includeCost));
  } catch (err) {
    next(err);
  }
}

// Public-ish lookup endpoints (still auth-gated).

async function findByBarcode(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { barcode } = req.params;
    const { rows } = await query(
      `SELECT v.id FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.is_active = true AND p.is_active = true
          AND (v.barcode = $1 OR v.internal_barcode = $1 OR v.supplier_barcode = $1)
        LIMIT 1`,
      [barcode],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, await loadVariantWithAttributes(rows[0].id, includeCost));
  } catch (err) {
    next(err);
  }
}

async function findBySku(req, res, next) {
  try {
    const includeCost = canSeeCost(req);
    const { sku } = req.params;
    const { rows } = await query(
      `SELECT id FROM product_variants WHERE sku = $1 AND is_active = true LIMIT 1`,
      [sku],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, await loadVariantWithAttributes(rows[0].id, includeCost));
  } catch (err) {
    next(err);
  }
}

async function generateBarcode(req, res, next) {
  try {
    const { categoryId } = req.body || {};
    const code = await generateUniqueInternalBarcode(categoryId || null);
    return ok(res, { barcode: code });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  update,
  remove,
  uploadImage,
  deleteVariantImage,
  findByBarcode,
  findBySku,
  generateBarcode,
};
