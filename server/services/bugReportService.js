const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query, withTransaction } = require('../db/postgres');
const { nextDocumentNumber } = require('../utils/docNumbers');
const { getUploadsRoot } = require('../utils/paths');
const notificationService = require('./notificationService');

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'credit_card',
  'card_number',
  'cvv',
  'pin',
]);

function sanitizeBreadcrumbs(breadcrumbs) {
  if (!Array.isArray(breadcrumbs)) return [];
  return breadcrumbs.slice(-10).map((b) => {
    if (!b || typeof b !== 'object') return b;
    const data = { ...b.data };
    for (const key of Object.keys(data || {})) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        data[key] = '[redacted]';
      }
    }
    return { ...b, data };
  });
}

function bugReportDir(reportId) {
  return path.join(getUploadsRoot(), 'bug-reports', reportId);
}

async function saveScreenshot(reportId, fileBuffer) {
  if (!fileBuffer?.length) return null;
  const dir = bugReportDir(reportId);
  await fs.promises.mkdir(dir, { recursive: true });
  const filename = 'screenshot.jpg';
  const fullPath = path.join(dir, filename);
  await sharp(fileBuffer)
    .resize(1280, 720, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(fullPath);
  return path.relative(getUploadsRoot(), fullPath).replace(/\\/g, '/');
}

async function createBugReport({
  reportedBy,
  pcIdentifier,
  appVersion,
  osInfo,
  screen,
  whatWereYouDoing,
  whatHappened,
  urgency,
  errorCode = null,
  stackTrace = null,
  breadcrumbs = [],
  deviceInfo = null,
  screenshotBuffer = null,
}) {
  return withTransaction(async (client) => {
    const { formatted: ticketNumber } = await nextDocumentNumber(
      client,
      'BUG',
      new Date().getFullYear(),
      { padWidth: 5 },
    );

    const insert = await client.query(
      `INSERT INTO bug_reports
         (ticket_number, reported_by, pc_identifier, app_version, os_info,
          screen, what_were_you_doing, what_happened, urgency,
          error_code, stack_trace, breadcrumbs, device_info, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,'open')
       RETURNING *`,
      [
        ticketNumber,
        reportedBy,
        pcIdentifier,
        appVersion,
        osInfo,
        screen,
        whatWereYouDoing,
        whatHappened,
        urgency,
        errorCode,
        stackTrace,
        JSON.stringify(sanitizeBreadcrumbs(breadcrumbs)),
        deviceInfo ? JSON.stringify(deviceInfo) : null,
      ],
    );
    const report = insert.rows[0];

    if (screenshotBuffer?.length) {
      const rel = await saveScreenshot(report.id, screenshotBuffer);
      if (rel) {
        const upd = await client.query(
          `UPDATE bug_reports SET screenshot_path = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
          [report.id, rel],
        );
        return upd.rows[0];
      }
    }
    return report;
  }).then(async (report) => {
    // Notify admins — blocking reports are critical.
    try {
      const severity = report.urgency === 'blocking' ? 'critical' : 'warning';
      await notificationService.notifyRoles(['Admin'], {
        type: 'system.bug_report_submitted',
        category: 'system',
        severity,
        title: `Bug report ${report.ticket_number}`,
        message: `${report.urgency} — ${whatHappened.slice(0, 120)}`,
        referenceType: 'bug_report',
        referenceId: report.id,
        actionUrl: `/admin/bug-reports/${report.id}`,
        createdBy: reportedBy,
      });
    } catch (_e) {
      /* best-effort */
    }
    return report;
  });
}

async function listBugReports({
  limit = 30,
  offset = 0,
  status = null,
  urgency = null,
  search = null,
  from = null,
  to = null,
}) {
  const where = [];
  const params = [];
  if (status) {
    params.push(status);
    where.push(`b.status = $${params.length}`);
  }
  if (urgency) {
    params.push(urgency);
    where.push(`b.urgency = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(b.ticket_number ILIKE $${params.length} OR b.what_happened ILIKE $${params.length} OR b.screen ILIKE $${params.length})`,
    );
  }
  if (from) {
    params.push(from);
    where.push(`b.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`b.created_at <= $${params.length}::timestamptz`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT b.*, u.username AS reported_by_username,
            a.username AS assigned_to_username
       FROM bug_reports b
       LEFT JOIN users u ON u.id = b.reported_by
       LEFT JOIN users a ON a.id = b.assigned_to
       ${whereSql}
      ORDER BY b.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const count = await query(
    `SELECT COUNT(*)::int AS count FROM bug_reports b ${whereSql}`,
    params,
  );
  return { rows, total: count.rows[0].count };
}

async function getBugReportById(id) {
  const { rows } = await query(
    `SELECT b.*, u.username AS reported_by_username,
            a.username AS assigned_to_username
       FROM bug_reports b
       LEFT JOIN users u ON u.id = b.reported_by
       LEFT JOIN users a ON a.id = b.assigned_to
      WHERE b.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const comments = await query(
    `SELECT c.*, u.username AS author_username
       FROM bug_report_comments c
       LEFT JOIN users u ON u.id = c.commented_by
      WHERE c.bug_report_id = $1
      ORDER BY c.created_at ASC`,
    [id],
  );
  return { ...rows[0], comments: comments.rows };
}

async function updateBugReport(id, patch) {
  const fields = [];
  const params = [id];
  const allowed = {
    status: 'status',
    assigned_to: 'assigned_to',
    resolution_note: 'resolution_note',
  };
  for (const [k, col] of Object.entries(allowed)) {
    if (patch[k] !== undefined) {
      params.push(patch[k]);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (patch.status === 'resolved' || patch.status === 'wont_fix') {
    fields.push('resolved_at = NOW()');
  }
  if (!fields.length) return getBugReportById(id);
  fields.push('updated_at = NOW()');
  const { rows } = await query(
    `UPDATE bug_reports SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0];
}

async function addComment(bugReportId, { comment, commentedBy }) {
  const { rows } = await query(
    `INSERT INTO bug_report_comments (bug_report_id, comment, commented_by)
     VALUES ($1,$2,$3)
     RETURNING *`,
    [bugReportId, comment, commentedBy],
  );
  await query(
    `UPDATE bug_reports SET updated_at = NOW() WHERE id = $1`,
    [bugReportId],
  );
  return rows[0];
}

async function getSummary() {
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
       COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
       COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at > date_trunc('month', NOW()))::int AS resolved_month,
       COUNT(*) FILTER (WHERE status = 'open' AND urgency = 'blocking')::int AS blocking_open
     FROM bug_reports`,
  );
  return rows[0];
}

module.exports = {
  createBugReport,
  listBugReports,
  getBugReportById,
  updateBugReport,
  addComment,
  getSummary,
  sanitizeBreadcrumbs,
};
