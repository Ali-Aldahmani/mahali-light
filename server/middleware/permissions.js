const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// requirePermission('user.create') or requirePermission('user.create', 'user.edit')
// User must have ALL listed permissions.
function requirePermission(...keys) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(ERROR_CODES.AUTH_TOKEN_MISSING, undefined, { status: 401 }));
    }
    const owned = new Set(req.user.permissions || []);
    const missing = keys.filter((k) => !owned.has(k));
    if (missing.length) {
      return next(
        new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, {
          status: 403,
          details: { missing },
        }),
      );
    }
    next();
  };
}

module.exports = { requirePermission };
