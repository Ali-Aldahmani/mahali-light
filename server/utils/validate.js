const { z } = require('zod');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { todayStoreDate } = require('./dates');

// Wrap a Zod schema into express middleware. `where` may be 'body' | 'query' | 'params'.
function validateBody(schema, where = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[where]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return next(
        new AppError(ERROR_CODES.VALIDATION_FAILED, undefined, {
          status: 400,
          details,
        }),
      );
    }
    req[where] = result.data;
    next();
  };
}

// The day a money movement is booked to. A real calendar day and never in the
// future: cash moves now, so a far-off date would put the ledger out of step
// with the drawer and create accounting periods for that year. A malformed
// value used to reach SQL and come back as a 500.
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Use a date in the form YYYY-MM-DD.')
  .transform((value) => value.slice(0, 10))
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
  }, 'That date does not exist.')
  .refine((day) => day <= todayStoreDate(), 'The date cannot be in the future.');

module.exports = { validateBody, businessDateSchema };
