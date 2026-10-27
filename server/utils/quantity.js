const { z } = require('zod');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// One quantity rule for every stock entry point (invoice audit F13,
// inventory audit INV-004). Stock and movements are stored as DECIMAL(12,2),
// so a quantity has at most two decimals and is refused, not rounded — before,
// 0.004 silently became zero. Products sold by the piece move in whole units.
const MAX_QUANTITY = 1000000;

function hasAtMostTwoDecimals(q) {
  return Math.abs(q * 100 - Math.round(q * 100)) <= 1e-6;
}

function assertQuantity(quantity, { soldBy = null, name = 'item', allowZero = false } = {}) {
  const q = Number(quantity);
  const invalid = (message) => new AppError(ERROR_CODES.VALIDATION_FAILED, message, { status: 400 });
  if (!Number.isFinite(q) || q < 0 || (!allowZero && q === 0)) {
    throw invalid(`Quantity for ${name} must be more than zero.`);
  }
  if (q > MAX_QUANTITY) throw invalid(`Quantity for ${name} is too large.`);
  if (!hasAtMostTwoDecimals(q)) {
    throw invalid(`Quantity for ${name} can have at most two decimal places.`);
  }
  if ((soldBy || 'piece') === 'piece' && !Number.isInteger(Math.round(q * 100) / 100)) {
    throw invalid(`${name} is sold by the piece, so its quantity must be a whole number.`);
  }
}

// Request-schema version of the same bounds. The sold-by rule needs the
// product, so applyStockMovement checks that once the variant is loaded.
// Opening stock and counted quantities may be zero; movements may not.
const nonNegativeQuantitySchema = z.number()
  .finite()
  .min(0)
  .max(MAX_QUANTITY)
  .refine(hasAtMostTwoDecimals, 'Quantity can have at most two decimal places.');
const quantitySchema = nonNegativeQuantitySchema.refine((q) => q > 0, 'Quantity must be more than zero.');

module.exports = { MAX_QUANTITY, assertQuantity, quantitySchema, nonNegativeQuantitySchema };
