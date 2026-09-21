const { z } = require('zod');
const { ok, created } = require('../utils/response');
const { withTransaction } = require('../db/postgres');
const svc = require('../services/pricingRestrictionService');

const upsertSchema = z
  .object({
    restrictionType: z.enum(['MINIMUM_PRICE', 'MAX_DISCOUNT_PERCENT', 'MAX_DISCOUNT_AMOUNT']),
    minPrice: z.number().nonnegative().optional().nullable(),
    maxDiscountPercent: z.number().min(0).max(100).optional().nullable(),
    maxDiscountAmount: z.number().nonnegative().optional().nullable(),
  })
  .strict();

const bulkSchema = z
  .object({
    productIds: z.array(z.string().uuid()).min(1).max(500),
    restrictionType: z.enum(['MAX_DISCOUNT_PERCENT', 'MAX_DISCOUNT_AMOUNT']),
    maxDiscountPercent: z.number().min(0).max(100).optional().nullable(),
    maxDiscountAmount: z.number().nonnegative().optional().nullable(),
  })
  .strict();

async function list(req, res, next) {
  try {
    const rows = await svc.listRestrictions();
    return ok(res, rows);
  } catch (err) {
    next(err);
  }
}

async function getForProduct(req, res, next) {
  try {
    const row = await svc.getRestriction(null, req.params.productId);
    return ok(res, svc.shape(row));
  } catch (err) {
    next(err);
  }
}

async function upsertForProduct(req, res, next) {
  try {
    const body = upsertSchema.parse(req.body || {});
    const result = await withTransaction((client) =>
      svc.upsertRestriction(client, {
        productId: req.params.productId,
        restrictionType: body.restrictionType,
        minPrice: body.minPrice,
        maxDiscountPercent: body.maxDiscountPercent,
        maxDiscountAmount: body.maxDiscountAmount,
        actorId: req.user.id,
      }),
    );
    return created(res, result);
  } catch (err) {
    next(err);
  }
}

async function removeForProduct(req, res, next) {
  try {
    await withTransaction((client) =>
      svc.removeRestriction(client, { productId: req.params.productId, actorId: req.user.id }),
    );
    return ok(res, { removed: true });
  } catch (err) {
    next(err);
  }
}

async function bulkApply(req, res, next) {
  try {
    const body = bulkSchema.parse(req.body || {});
    const results = await withTransaction((client) =>
      svc.bulkApplyMaxDiscount(client, {
        productIds: body.productIds,
        restrictionType: body.restrictionType,
        maxDiscountPercent: body.maxDiscountPercent,
        maxDiscountAmount: body.maxDiscountAmount,
        actorId: req.user.id,
      }),
    );
    return created(res, results);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getForProduct, upsertForProduct, removeForProduct, bulkApply };
