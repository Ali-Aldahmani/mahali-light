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

  // Persist every API error (append-only).
  await errorLogService.logError({
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
  });

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status || 500).json({
    success: false,
    error: {
      code,
      message,
      details: details || null,
      field: field || null,
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

  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    log(ERROR_CODES.INTERNAL_ERROR, err, 'scheduler');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log(ERROR_CODES.INTERNAL_ERROR, err, 'scheduler');
  });
}

module.exports = { notFoundHandler, errorHandler, registerProcessHandlers };
