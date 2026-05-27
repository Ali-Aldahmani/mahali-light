const { query } = require('../db/postgres');
const {
  ERROR_CODES,
  AppError,
  defaultSeverityForCode,
  getErrorDef,
} = require('../../shared/errorCodes');
const { checkEscalation } = require('./escalationService');

// Append-only error log writer. Called from the global error handler and
// from process-level handlers for uncaught exceptions.
async function logError({
  code,
  message,
  details = null,
  severity = null,
  source = 'api',
  userId = null,
  pcIdentifier = null,
  endpoint = null,
  method = null,
  stackTrace = null,
}) {
  const def = getErrorDef(code);
  const sev =
    severity || def?.severity || defaultSeverityForCode(code, def?.status || 500);

  const storeStack =
    sev === 'error' || sev === 'critical' ? stackTrace || null : null;

  try {
    const { rows } = await query(
      `INSERT INTO error_logs
         (code, message, details, severity, source, user_id, pc_identifier,
          endpoint, method, stack_trace)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, code, severity, created_at`,
      [
        code,
        message,
        details ? JSON.stringify(details) : null,
        sev,
        source,
        userId,
        pcIdentifier,
        endpoint,
        method,
        storeStack,
      ],
    );

    // Auto-escalation runs after every insert (deduped in-memory).
    if (rows[0]) {
      checkEscalation({
        errorCode: code,
        message,
        severity: sev,
        logId: rows[0].id,
      }).catch(() => {});
    }

    return rows[0];
  } catch (err) {
    console.warn('[errorLogService] failed to persist error log', err.message);
    return null;
  }
}

async function listErrors({
  page = 1,
  limit = 30,
  offset = 0,
  code = null,
  severity = null,
  resolved = null,
  search = null,
  from = null,
  to = null,
}) {
  const where = [];
  const params = [];
  if (code) {
    params.push(code);
    where.push(`e.code = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    where.push(`e.severity = $${params.length}`);
  }
  if (resolved === 'true' || resolved === true) {
    where.push('e.resolved = true');
  } else if (resolved === 'false' || resolved === false) {
    where.push('e.resolved = false');
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(e.code ILIKE $${params.length} OR e.message ILIKE $${params.length})`,
    );
  }
  if (from) {
    params.push(from);
    where.push(`e.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`e.created_at <= $${params.length}::timestamptz`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT e.*, u.username AS user_username,
            r.username AS resolved_by_username
       FROM error_logs e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users r ON r.id = e.resolved_by
       ${whereSql}
      ORDER BY e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const count = await query(
    `SELECT COUNT(*)::int AS count FROM error_logs e ${whereSql}`,
    params,
  );
  return { rows, total: count.rows[0].count, page, limit };
}

async function getErrorById(id) {
  const { rows } = await query(
    `SELECT e.*, u.username AS user_username,
            r.username AS resolved_by_username
       FROM error_logs e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users r ON r.id = e.resolved_by
      WHERE e.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function resolveError(id, { resolvedBy, resolutionNote }) {
  const { rows } = await query(
    `UPDATE error_logs
        SET resolved = true,
            resolved_by = $2,
            resolved_at = NOW(),
            resolution_note = $3
      WHERE id = $1
      RETURNING *`,
    [id, resolvedBy, resolutionNote || null],
  );
  return rows[0] || null;
}

async function getSummary() {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE severity = 'critical' AND created_at > NOW() - INTERVAL '7 days')::int AS critical_7d,
       COUNT(*) FILTER (WHERE severity = 'error' AND created_at > NOW() - INTERVAL '7 days')::int AS error_7d,
       COUNT(*) FILTER (WHERE severity = 'warning' AND created_at > NOW() - INTERVAL '7 days')::int AS warning_7d,
       COUNT(*) FILTER (WHERE severity = 'info' AND created_at > NOW() - INTERVAL '7 days')::int AS info_7d,
       COUNT(*) FILTER (WHERE resolved = false)::int AS unresolved,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS last_hour
     FROM error_logs`,
  );
  return rows[0];
}

async function cleanupResolvedOlderThan(days = 90) {
  const { rowCount } = await query(
    `DELETE FROM error_logs
      WHERE resolved = true
        AND resolved_at < NOW() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return { deleted: rowCount };
}

// Classify raw errors into our standard codes (used by middleware).
function classifyError(err) {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      status: err.status || 400,
      details: err.details,
      field: err.field || null,
      severity: err.severity,
      stack: err.stack,
    };
  }

  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    const code =
      err.name === 'TokenExpiredError'
        ? ERROR_CODES.AUTH_SESSION_EXPIRED
        : ERROR_CODES.AUTH_TOKEN_INVALID;
    const e = new AppError(code);
    return {
      code: e.code,
      message: e.message,
      status: e.status,
      details: null,
      field: null,
      severity: e.severity,
      stack: err.stack,
    };
  }

  if (err?.name === 'MulterError') {
    const code =
      err.code === 'LIMIT_FILE_SIZE'
        ? ERROR_CODES.FILE_TOO_LARGE
        : ERROR_CODES.FILE_UPLOAD_FAILED;
    const e = new AppError(code, { allowed: err.field || 'file' });
    return {
      code: e.code,
      message: e.message,
      status: e.status,
      details: e.details,
      field: null,
      severity: e.severity,
      stack: err.stack,
    };
  }

  if (err?.type === 'entity.parse.failed') {
    const e = new AppError(ERROR_CODES.VALIDATION_FAILED, 'Malformed JSON body.');
    return {
      code: e.code,
      message: e.message,
      status: 400,
      details: null,
      field: null,
      severity: 'warning',
      stack: err.stack,
    };
  }

  // PostgreSQL errors
  const pgCode = err?.code;
  if (pgCode && String(pgCode).startsWith('23')) {
    const e = new AppError(ERROR_CODES.DB_CONSTRAINT_VIOLATION, {
      constraint: err.constraint,
    });
    return {
      code: e.code,
      message: e.message,
      status: 409,
      details: { constraint: err.constraint },
      field: null,
      severity: 'warning',
      stack: err.stack,
    };
  }
  if (pgCode === 'ECONNREFUSED' || pgCode === '57P01' || pgCode === '53300') {
    const e = new AppError(ERROR_CODES.DB_CONNECTION_FAILED);
    return {
      code: e.code,
      message: e.message,
      status: 500,
      details: null,
      field: null,
      severity: 'critical',
      stack: err.stack,
    };
  }

  const e = new AppError(ERROR_CODES.DB_QUERY_FAILED);
  return {
    code: ERROR_CODES.DB_QUERY_FAILED,
    message: err?.message || e.message,
    status: 500,
    details: process.env.NODE_ENV === 'development' ? { hint: err?.hint } : null,
    field: null,
    severity: 'error',
    stack: err.stack,
  };
}

module.exports = {
  logError,
  listErrors,
  getErrorById,
  resolveError,
  getSummary,
  cleanupResolvedOlderThan,
  classifyError,
};
