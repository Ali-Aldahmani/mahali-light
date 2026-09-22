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

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    restrictionType: row.restriction_type,
    minPrice: row.min_price != null ? Number(row.min_price) : null,
    maxDiscountPercent: row.max_discount_percent != null ? Number(row.max_discount_percent) : null,
    maxDiscountAmount: row.max_discount_amount != null ? Number(row.max_discount_amount) : null,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Validate that exactly the one value column matching restriction_type is
// set — the DB CHECK constraint (031_pricing_restrictions.sql) enforces the
// same rule as a last-resort integrity guard; this is the app-level check
// that gives callers a clean 400 instead of a raw constraint-violation error.
function assertValidRestrictionShape({ restrictionType, minPrice, maxDiscountPercent, maxDiscountAmount }) {
  if (!RESTRICTION_TYPES.includes(restrictionType)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid restriction type.', { status: 400 });
  }
  const values = { MINIMUM_PRICE: minPrice, MAX_DISCOUNT_PERCENT: maxDiscountPercent, MAX_DISCOUNT_AMOUNT: maxDiscountAmount };
  for (const [type, val] of Object.entries(values)) {
    const shouldBeSet = type === restrictionType;
    const isSet = val != null;
    if (shouldBeSet && !isSet) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED,
        `${restrictionType} requires a value.`, { status: 400 });
    }
    if (!shouldBeSet && isSet) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED,
        'MINIMUM_PRICE, MAX_DISCOUNT_PERCENT and MAX_DISCOUNT_AMOUNT are mutually exclusive — only one may be set.',
        { status: 400 });
    }
  }
}

// One row per product; keyed by product_id so "exactly one restriction per
// product" is a UNIQUE constraint, not an app-level race.
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

// Create or replace the one restriction for a product. Used directly by the
// single-product endpoint and looped (one call per product, same
// transaction) by bulkApplyMaxDiscount — the actual persistence/audit logic
// lives in exactly one place either way.
async function upsertRestriction(client, { productId, restrictionType, minPrice, maxDiscountPercent, maxDiscountAmount, actorId }) {
  assertValidRestrictionShape({ restrictionType, minPrice, maxDiscountPercent, maxDiscountAmount });

  const q = client ? client.query.bind(client) : query;
  const { rows: productRows } = await q(`SELECT id, name FROM products WHERE id = $1`, [productId]);
  if (!productRows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Product not found.', { status: 404 });
  }

  const before = await getRestriction(client, productId);

  const { rows } = await q(
    `INSERT INTO pricing_restrictions
       (product_id, restriction_type, min_price, max_discount_percent, max_discount_amount, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (product_id) DO UPDATE
        SET restriction_type = EXCLUDED.restriction_type,
            min_price = EXCLUDED.min_price,
            max_discount_percent = EXCLUDED.max_discount_percent,
            max_discount_amount = EXCLUDED.max_discount_amount,
            updated_by = EXCLUDED.updated_by,
            updated_at = NOW()
     RETURNING *`,
    [
      productId,
      restrictionType,
      restrictionType === 'MINIMUM_PRICE' ? money(minPrice) : null,
      restrictionType === 'MAX_DISCOUNT_PERCENT' ? Number(maxDiscountPercent) : null,
      restrictionType === 'MAX_DISCOUNT_AMOUNT' ? money(maxDiscountAmount) : null,
      actorId,
    ],
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

// Requirement #2 — apply the same MAX_DISCOUNT_* rule to many products in
// one admin action. Reuses upsertRestriction per product inside one
// transaction (all-or-nothing) rather than a separate bulk code path, so
// the mutual-exclusivity/validation/audit logic is never duplicated.
async function bulkApplyMaxDiscount(client, { productIds, restrictionType, maxDiscountPercent, maxDiscountAmount, actorId }) {
  if (!['MAX_DISCOUNT_PERCENT', 'MAX_DISCOUNT_AMOUNT'].includes(restrictionType)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED,
      'Bulk apply only supports MAX_DISCOUNT_PERCENT or MAX_DISCOUNT_AMOUNT.', { status: 400 });
  }
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Select at least one product.', { status: 400 });
  }
  const results = [];
  for (const productId of ids) {
    results.push(await upsertRestriction(client, {
      productId, restrictionType, maxDiscountPercent, maxDiscountAmount, actorId,
    }));
  }
  return results;
}

// The single source of truth for "is this final price allowed" — called
// from every place an invoice line's price/discount is set (invoiceService
// replaceItems + applyEditRequest's existing-item branch). catalogPrice and
// netUnitPrice must both already be server-resolved values, never client
// input. Silently does nothing when no restriction exists for the product.
function assertPriceAllowed({ restriction, catalogPrice, netUnitPrice, productName }) {
  if (!restriction) return;
  const catalog = money(catalogPrice);
  const net = money(netUnitPrice);
  const discountPerUnit = money(catalog - net);

  if (restriction.restriction_type === 'MINIMUM_PRICE') {
    const min = Number(restriction.min_price);
    if (net < min - 0.005) {
      throw new AppError(ERROR_CODES.BIZ_PRICING_RESTRICTION_VIOLATION, {
        product: productName || 'this product',
        reason: `minimum price is AED ${min.toFixed(2)}, got AED ${net.toFixed(2)}`,
      }, { status: 422, details: { restrictionType: restriction.restriction_type, minPrice: min, attemptedPrice: net } });
    }
    return;
  }

  if (restriction.restriction_type === 'MAX_DISCOUNT_PERCENT') {
    const max = Number(restriction.max_discount_percent);
    const pct = catalog > 0 ? (discountPerUnit / catalog) * 100 : 0;
    if (discountPerUnit > 0.005 && pct > max + 0.01) {
      throw new AppError(ERROR_CODES.BIZ_PRICING_RESTRICTION_VIOLATION, {
        product: productName || 'this product',
        reason: `maximum discount is ${max}%, got ${pct.toFixed(2)}%`,
      }, { status: 422, details: { restrictionType: restriction.restriction_type, maxDiscountPercent: max, attemptedPercent: money(pct) } });
    }
    return;
  }

  if (restriction.restriction_type === 'MAX_DISCOUNT_AMOUNT') {
    const max = Number(restriction.max_discount_amount);
    if (discountPerUnit > max + 0.005) {
      throw new AppError(ERROR_CODES.BIZ_PRICING_RESTRICTION_VIOLATION, {
        product: productName || 'this product',
        reason: `maximum discount is AED ${max.toFixed(2)} per unit, got AED ${discountPerUnit.toFixed(2)}`,
      }, { status: 422, details: { restrictionType: restriction.restriction_type, maxDiscountAmount: max, attemptedDiscount: discountPerUnit } });
    }
  }
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
  assertPriceAllowed,
};
