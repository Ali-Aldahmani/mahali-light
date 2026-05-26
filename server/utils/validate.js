const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

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

module.exports = { validateBody };
