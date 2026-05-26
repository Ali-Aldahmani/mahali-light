const { AppError, ERROR_CODES, ERROR_MESSAGES } = require('../../shared/errorCodes');
const { query } = require('../db/postgres');

// Standard error response shape:
//   { success: false, error: { code, message, details } }
function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    error: {
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let code = ERROR_CODES.INTERNAL_ERROR;
  let status = 500;
  let message = ERROR_MESSAGES[code];
  let details = null;

  if (err instanceof AppError) {
    code = err.code;
    status = err.status || 400;
    message = err.message || ERROR_MESSAGES[code] || 'Error';
    details = err.details || null;
  } else if (err && err.code === '23505') {
    // Postgres unique violation
    code = ERROR_CODES.RESOURCE_CONFLICT;
    status = 409;
    message = ERROR_MESSAGES[code];
    details = { constraint: err.constraint };
  } else if (err && err.type === 'entity.parse.failed') {
    code = ERROR_CODES.VALIDATION_FAILED;
    status = 400;
    message = 'Malformed JSON body';
  }

  if (status >= 500) {
    console.error('[error]', err);
    // Persist server errors to activity_log for ops triage. Best-effort only.
    query(
      `INSERT INTO activity_log (entity_type, action, performed_by, notes)
       VALUES ($1,$2,$3,$4)`,
      ['system', 'server.error', req.user ? req.user.id : null, err.stack || err.message || 'unknown'],
    ).catch(() => {});
  }

  res.status(status).json({
    success: false,
    error: { code, message, details },
  });
}

module.exports = { notFoundHandler, errorHandler };
