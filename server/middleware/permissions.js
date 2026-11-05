const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// Marks a middleware as a permission check, so a test can confirm that every
// signed-in route has one (tests/contracts/routePermissions.contract.test.js).
function tagPermissionCheck(keys, fn) {
  fn.permissionCheck = keys;
  return fn;
}

// requirePermission('user.create') or requirePermission('user.create', 'user.edit')
// User must have ALL listed permissions.
function requirePermission(...keys) {
  return tagPermissionCheck(keys, (req, _res, next) => {
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
  });
}

// requireAnyPermission('return.approve', 'invoice.edit_approve', ...)
// User must have at least one listed permission (or '*').
function requireAnyPermission(...keys) {
  return tagPermissionCheck(keys, (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(ERROR_CODES.AUTH_TOKEN_MISSING, undefined, { status: 401 }));
    }
    const owned = new Set(req.user.permissions || []);
    if (owned.has('*') || keys.some((k) => owned.has(k))) {
      return next();
    }
    return next(
      new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, {
        status: 403,
        details: { anyOf: keys },
      }),
    );
  });
}

// Removes fields from every JSON response on a route unless the user holds the
// permission. For routes whose job is open to more people than some of the
// figures in them are (a Warehouse user may see suppliers, not what they cost).
function hideFieldsWithoutPermission(permission, fields) {
  const hidden = new Set(fields);
  const strip = (value) => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !hidden.has(key)).map(([key, child]) => [key, strip(child)]),
    );
  };
  return (req, res, next) => {
    if (!(req.user?.permissions || []).includes(permission)) {
      const json = res.json.bind(res);
      res.json = (body) => json(strip(body));
    }
    next();
  };
}

module.exports = { requirePermission, requireAnyPermission, hideFieldsWithoutPermission };
