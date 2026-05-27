const { query } = require('../db/postgres');
const notificationService = require('./notificationService');

// In-memory dedupe: errorCode -> last escalation timestamp (ms).
const lastEscalationByCode = new Map();
const ESCALATION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const OCCURRENCE_THRESHOLD = 3;
const OCCURRENCE_WINDOW_HOURS = 1;

async function checkEscalation({ errorCode, message, severity, logId }) {
  if (!errorCode) return null;

  const last = lastEscalationByCode.get(errorCode);
  if (last && Date.now() - last < ESCALATION_WINDOW_MS) {
    return null;
  }

  const { rows } = await query(
    `SELECT COUNT(*)::int AS count,
            array_agg(DISTINCT COALESCE(pc_identifier, 'unknown')) AS pcs,
            array_agg(DISTINCT u.username) FILTER (WHERE u.username IS NOT NULL) AS users
       FROM error_logs e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.code = $1
        AND e.created_at > NOW() - INTERVAL '1 hour'`,
    [errorCode],
  );

  const count = rows[0]?.count || 0;
  if (count < OCCURRENCE_THRESHOLD) return null;

  const pcs = (rows[0]?.pcs || []).filter(Boolean).slice(0, 5);
  const users = (rows[0]?.users || []).filter(Boolean).slice(0, 5);
  const pcList = pcs.length ? pcs.join(', ') : 'unknown';
  const userList = users.length ? users.join(', ') : 'unknown';

  lastEscalationByCode.set(errorCode, Date.now());

  const title = `${errorCode} reported ${count} times in 1 hour`;
  const body = `Affected PCs: ${pcList}. Users: ${userList}. Latest: ${message || ''}`.trim();

  try {
    await notificationService.notifyRoles(['Admin'], {
      type: 'system.error_escalated',
      category: 'system',
      severity: severity === 'critical' ? 'critical' : 'error',
      title: `⚠️ ${title}`,
      message: body,
      referenceType: 'error_log',
      referenceId: logId || null,
      actionUrl: '/admin/error-logs',
      dedupeKey: `escalation.${errorCode}`,
    });
  } catch (_err) {
    /* best-effort */
  }

  return { errorCode, count, pcs, users };
}

async function getRecentEscalations() {
  const { rows } = await query(
    `SELECT code,
            COUNT(*)::int AS count,
            MAX(created_at) AS last_seen,
            array_agg(DISTINCT pc_identifier) FILTER (WHERE pc_identifier IS NOT NULL) AS pcs
       FROM error_logs
      WHERE created_at > NOW() - INTERVAL '1 hour'
        AND severity IN ('error', 'critical')
      GROUP BY code
     HAVING COUNT(*) >= $1
      ORDER BY count DESC
      LIMIT 10`,
    [OCCURRENCE_THRESHOLD],
  );
  return rows;
}

module.exports = { checkEscalation, getRecentEscalations };
