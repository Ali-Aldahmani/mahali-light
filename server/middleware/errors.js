const {
  AppError,
  ERROR_CODES,
} = require('../../shared/errorCodes');
const errorLogService = require('../services/errorLogService');

function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    error: {
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      details: null,
      field: null,
    },
  });
}

function headerPc(req) {
  return (
    req.headers['x-pc-identifier'] ||
    req.headers['x-pc-id'] ||
    null
  );
}

// eslint-disable-next-line no-unused-vars
async function errorHandler(err, req, res, _next) {
  const classified = errorLogService.classifyError(err);
  const { code, message, status, details, field, severity, stack } = classified;

  // Persist API errors (append-only). A client error (4xx) from a request
  // with no valid sign-in isn't recorded: anyone on the network could
  // otherwise grow this table, and trigger admin escalations, by sending
  // requests with no token or from a disallowed origin (audit F-OPS-04).
  // Server faults (5xx) are always recorded.
  //
  // Not awaited (audit F-OPS-03): the reply must not wait on an extra
  // database write, least of all when the database is the thing failing.
  if (status >= 500 || req.user) {
    errorLogService.logError({
      code,
      message,
      details,
      severity,
      source: 'api',
      userId: req.user?.id || null,
      pcIdentifier: headerPc(req),
      endpoint: req.originalUrl || req.path,
      method: req.method,
      stackTrace: stack,
    }).catch((logErr) => {
      console.error('[error] could not record error log:', logErr?.message || logErr);
    });
  }

  if (status >= 500) {
    console.error(`[error] [${req.id || 'no-request-id'}]`, err);
  }

  res.status(status || 500).json({
    success: false,
    error: {
      code,
      message,
      details: details || null,
      field: field || null,
      requestId: req.id || null,
    },
  });
}

function registerProcessHandlers() {
  const log = (code, err, source) => {
    errorLogService
      .logError({
        code,
        message: err?.message || String(err),
        severity: 'critical',
        source,
        stackTrace: err?.stack,
      })
      .catch(() => {});
  };

  // After an uncaught exception the process is in an unknown state (a
  // server that failed to listen, a half-run job). Record it, then exit so
  // the restart policy brings up a clean process (audit F-OPS-02). The log
  // write gets a moment to finish first.
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    const done = () => process.exit(1);
    const timer = setTimeout(done, 1500);
    if (typeof timer.unref === 'function') timer.unref();
    errorLogService
      .logError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: err?.message || String(err),
        severity: 'critical',
        source: 'scheduler',
        stackTrace: err?.stack,
      })
      .catch(() => {})
      .finally(done);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log(ERROR_CODES.INTERNAL_ERROR, err, 'scheduler');
  });
}

module.exports = { notFoundHandler, errorHandler, registerProcessHandlers };
