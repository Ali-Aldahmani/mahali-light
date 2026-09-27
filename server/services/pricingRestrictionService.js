const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const RESTRICTION_TYPES = ['MINIMUM_PRICE', 'MAX_DISCOUNT_PERCENT', 'MAX_DISCOUNT_AMOUNT'];

function money(n) {
  n = Number(n) || 0;
  // Math.round(n*100)/100 alone mis-rounds values that land exactly on a
  // half-cent boundary due to IEEE-754 float representation (e.g. 2.90*0.05
  // is stored as 0.14499999999999999, rounding down to 0.14 instead of 0.15).
  // A tiny epsilon nudges genuine .xx5 boundaries the right way without
  // affecting any other value.
  return n < 0 ? -Math.round(-n * 100 + 1e-9) / 100 : Math.round(n * 100 + 1e-9) / 100;
}

function numOrNull(v) {
  return v != null ? Number(v) : null;
}

// A NULL value column means that restriction is disabled; any combination of
// the three may be enabled at once (034_pricing_restrictions_multi.sql).
function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    minPrice: numOrNull(row.min_price),
    maxDiscountPercent: numOrNull(row.max_discount_percent),
    maxDiscountAmount: numOrNull(row.max_discount_amount),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertValidValues({ minPrice, maxDiscountPercent, maxDiscountAmount }) {
  const bad = (v) => v != null && (!Number.isFinite(Number(v)) || Number(v) < 0);
  if (bad(minPrice)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Minimum price must be 0 or more.', { status: 400 });
  }
  if (bad(maxDiscountPercent) || (maxDiscountPercent != null && Number(maxDiscountPercent) > 100)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Max discount % must be between 0 and 100.', { status: 400 });
  }
  if (bad(maxDiscountAmount)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Max discount amount must be 0 or more.', { status: 400 });
  }
}

async function getRestriction(client, productId) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `SELECT * FROM pricing_restrictions WHERE product_id = $1`,
    [productId],
  );
  return rows[0] || null;
}

// Batch lookup for hot paths (replaceItems, applyEditRequest) that touch
// many product ids at once — avoids one query per line item.
async function getRestrictionsMap(client, productIds) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return new Map();
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `SELECT * FROM pricing_restrictions WHERE product_id = ANY($1)`,
    [ids],
  );
  return new Map(rows.map((r) => [r.product_id, r]));
}

async function listRestrictions() {
  const { rows } = await query(
    `SELECT pr.*, p.name AS product_name
       FROM pricing_restrictions pr
       JOIN products p ON p.id = pr.product_id
      ORDER BY p.name ASC`,
  );
  return rows.map(shape);
}

// Set the product's full restriction set. Each value is independent: NULL
// disables that rule. When every rule is disabled the row is deleted, so
// "no restrictions" never leaves an empty row behind. Returns null in that
// case.
async function upsertRestriction(client, { productId, minPrice, maxDiscountPercent, maxDiscountAmount, actorId }) {
  const values = {
    minPrice: minPrice != null ? money(minPrice) : null,
    maxDiscountPercent: maxDiscountPercent != null ? Number(maxDiscountPercent) : null,
    maxDiscountAmount: maxDiscountAmount != null ? money(maxDiscountAmount) : null,
  };
  assertValidValues(values);

  const q = client ? client.query.bind(client) : query;
  const { rows: productRows } = await q(`SELECT id, name FROM products WHERE id = $1`, [productId]);
  if (!productRows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Product not found.', { status: 404 });
  }

  const before = await getRestriction(client, productId);
  const allDisabled =
    values.minPrice == null && values.maxDiscountPercent == null && values.maxDiscountAmount == null;

  if (allDisabled) {
    if (before) await removeRestriction(client, { productId, actorId });
    return null;
  }

  const { rows } = await q(
    `INSERT INTO pricing_restrictions
       (product_id, min_price, max_discount_percent, max_discount_amount, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (product_id) DO UPDATE
        SET min_price = EXCLUDED.min_price,
            max_discount_percent = EXCLUDED.max_discount_percent,
            max_discount_amount = EXCLUDED.max_discount_amount,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
     RETURNING *`,
    [productId, values.minPrice, values.maxDiscountPercent, values.maxDiscountAmount, actorId],
  );
  const after = rows[0];

  await logActivity({
    entityType: 'pricing_restriction',
    entityId: after.id,
    action: before ? 'pricing_restriction.updated' : 'pricing_restriction.created',
    performedBy: actorId,
    oldValue: before ? shape(before) : null,
    newValue: shape({ ...after, product_name: productRows[0].name }),
    notes: `Product: ${productRows[0].name}`,
  });

  return shape({ ...after, product_name: productRows[0].name });
}

async function removeRestriction(client, { productId, actorId }) {
  const q = client ? client.query.bind(client) : query;
  const before = await getRestriction(client, productId);
  if (!before) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'No pricing restriction set for this product.', { status: 404 });
  }
  await q(`DELETE FROM pricing_restrictions WHERE product_id = $1`, [productId]);

  await logActivity({
    entityType: 'pricing_restriction',
    entityId: before.id,
    action: 'pricing_restriction.removed',
    performedBy: actorId,
    oldValue: shape(before),
    newValue: null,
  });
}

// Apply one MAX_DISCOUNT_* value to many products in one admin action.
// Only that rule is set; any other rules already enabled on each product are
// kept. All-or-nothing via the caller's transaction.
async function bulkApplyMaxDiscount(client, { productIds, restrictionType, maxDiscountPercent, maxDiscountAmount, actorId }) {
  if (!['MAX_DISCOUNT_PERCENT', 'MAX_DISCOUNT_AMOUNT'].includes(restrictionType)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED,
      'Bulk apply only supports MAX_DISCOUNT_PERCENT or MAX_DISCOUNT_AMOUNT.', { status: 400 });
  }
  const value = restrictionType === 'MAX_DISCOUNT_PERCENT' ? maxDiscountPercent : maxDiscountAmount;
  if (value == null) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `${restrictionType} requires a value.`, { status: 400 });
  }
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Select at least one product.', { status: 400 });
  }
  const results = [];
  for (const productId of ids) {
    const current = shape(await getRestriction(client, productId));
    results.push(await upsertRestriction(client, {
      productId,
      minPrice: current?.minPrice ?? null,
      maxDiscountPercent: restrictionType === 'MAX_DISCOUNT_PERCENT' ? value : current?.maxDiscountPercent ?? null,
      maxDiscountAmount: restrictionType === 'MAX_DISCOUNT_AMOUNT' ? value : current?.maxDiscountAmount ?? null,
      actorId,
    }));
  }
  return results;
}

// Evaluate every enabled rule independently and return all violations (empty
// array = allowed). catalogPrice and netUnitPrice must be server-resolved.
function evaluatePriceRestrictions({ restriction, catalogPrice, netUnitPrice }) {
  if (!restriction) return [];
  const catalog = money(catalogPrice);
  const net = money(netUnitPrice);
  const discountPerUnit = money(catalog - net);
  const violations = [];

  if (restriction.min_price != null) {
    const min = Number(restriction.min_price);
    if (net < min - 0.005) {
      violations.push({
        restrictionType: 'MINIMUM_PRICE',
        limit: min,
        attempted: net,
        message: `Minimum selling price is AED ${min.toFixed(2)}.`,
      });
    }
  }

  if (restriction.max_discount_percent != null) {
    const max = Number(restriction.max_discount_percent);
    const pct = catalog > 0 ? (discountPerUnit / catalog) * 100 : 0;
    if (discountPerUnit > 0.005 && pct > max + 0.01) {
      violations.push({
        restrictionType: 'MAX_DISCOUNT_PERCENT',
        limit: max,
        attempted: money(pct),
        message: `Maximum allowed discount is ${max}%.`,
      });
    }
  }

  if (restriction.max_discount_amount != null) {
    const max = Number(restriction.max_discount_amount);
    if (discountPerUnit > max + 0.005) {
      violations.push({
        restrictionType: 'MAX_DISCOUNT_AMOUNT',
        limit: max,
        attempted: discountPerUnit,
        message: `Maximum allowed discount amount is AED ${max.toFixed(2)}.`,
      });
    }
  }

  return violations;
}

// The single enforcement point for "is this final price allowed" — called
// from every place an invoice line's price/discount is set (invoiceService
// replaceItems + applyEditRequest's existing-item branch). Throws one 422
// listing every violated rule.
function assertPriceAllowed({ restriction, catalogPrice, netUnitPrice, productName }) {
  const violations = evaluatePriceRestrictions({ restriction, catalogPrice, netUnitPrice });
  if (!violations.length) return;
  const product = productName || 'this product';
  throw new AppError(
    ERROR_CODES.BIZ_PRICING_RESTRICTION_VIOLATION,
    `Price not allowed for ${product}. ${violations.map((v) => v.message).join(' ')}`,
    { status: 422, details: { product, violations } },
  );
}

module.exports = {
  RESTRICTION_TYPES,
  shape,
  getRestriction,
  getRestrictionsMap,
  listRestrictions,
  upsertRestriction,
  removeRestriction,
  bulkApplyMaxDiscount,
  evaluatePriceRestrictions,
  assertPriceAllowed,
};
