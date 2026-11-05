// Quarantined stock (customer returns in bad condition) had no way out: it
// couldn't be released, written off or sold, and stayed in the ledger forever
// while valuation ignored it. Review 5 Nov.
const { z } = require('zod');
const { withTransaction } = require('../db/postgres');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { applyStockMovement } = require('../services/stockService');
const { quantitySchema } = require('../utils/quantity');
const { emitEvent } = require('../socket/events');

const schema = z.object({
  action: z.enum(['release', 'write_off']),
  quantity: quantitySchema,
  reason: z.string().trim().min(5).max(500),
});

async function resolveQuarantine(req, res, next) {
  try {
    const body = schema.parse(req.body || {});
    const { variantId } = req.params;
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT product_id FROM product_variants WHERE id = $1`, [variantId],
      );
      if (!rows.length) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
      const common = {
        client,
        variantId,
        productId: rows[0].product_id,
        employeeId: req.user.id,
        referenceType: 'quarantine',
        skipReorderCheck: true,
      };
      // Release puts the units back on sale. A write-off releases them and
      // removes them as an adjustment, which books the loss against equity like
      // any other adjustment out.
      let moved = await applyStockMovement({
        ...common, type: 'quarantine_release', quantity: body.quantity,
        notes: `Quarantine ${body.action === 'release' ? 'released' : 'written off'}: ${body.reason}`,
      });
      if (body.action === 'write_off') {
        moved = await applyStockMovement({
          ...common, type: 'adjustment', quantity: -body.quantity, notes: `Write-off: ${body.reason}`,
        });
      }
      await logActivity({
        client,
        entityType: 'variant',
        entityId: variantId,
        action: body.action === 'release' ? 'stock.quarantine_released' : 'stock.quarantine_written_off',
        performedBy: req.user.id,
        newValue: { quantity: body.quantity },
        notes: body.reason,
      });
      return moved;
    });
    emitEvent(req.app.get('io'), 'stock_updated', {
      productId: null,
      movementType: body.action === 'release' ? 'quarantine_release' : 'adjustment',
      affectedVariants: [variantId],
      changedBy: req.user.id,
      timestamp: new Date().toISOString(),
      referenceType: 'quarantine',
      referenceId: variantId,
    });
    return ok(res, result.variant || result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(ERROR_CODES.VALIDATION_FAILED, err.errors[0]?.message, { status: 400 }));
    }
    next(err);
  }
}

module.exports = { resolveQuarantine };
