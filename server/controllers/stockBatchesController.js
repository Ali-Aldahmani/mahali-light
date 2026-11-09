const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const batchService = require('../services/batchService');

const listSchema = z.object({
  variantIds: z.string().min(1),
  includeEmpty: z.enum(['true', 'false']).optional(),
});

// GET /api/stock/batches?variantIds=a,b — the cost batches of up to 200
// variants. Cashiers use it to pick a batch at the till, so cost is only
// included with product.view_cost.
async function list(req, res, next) {
  try {
    const parsed = listSchema.parse(req.query);
    const ids = [...new Set(parsed.variantIds.split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length > 200 || ids.some((id) => !z.string().uuid().safeParse(id).success)) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'variantIds must be up to 200 variant ids.', { status: 400 });
    }
    const owned = req.user?.permissions || [];
    const data = await batchService.listBatches({
      variantIds: ids,
      includeEmpty: parsed.includeEmpty === 'true',
      includeCost: owned.includes('product.view_cost') || owned.includes('*'),
    });
    ok(res, data);
  } catch (err) {
    next(err.errors ? new AppError(ERROR_CODES.VALIDATION_FAILED, err.errors[0]?.message, { status: 400 }) : err);
  }
}

module.exports = { list };
