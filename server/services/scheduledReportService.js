const fs = require('fs');
const path = require('path');
const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const reportService = require('./reportService');
const reportExporter = require('./reportExporter');
const { logActivity } = require('../utils/activityLog');
const { getUploadsRoot } = require('../utils/paths');

// =======================================================================
// CRUD
// =======================================================================
function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    report_type: row.report_type,
    frequency: row.frequency,
    send_time: row.send_time,
    day_of_week: row.day_of_week,
    day_of_month: row.day_of_month,
    recipients: row.recipients || [],
    format: row.format,
    filters: row.filters || {},
    is_active: row.is_active,
    last_sent_at: row.last_sent_at,
    last_status: row.last_status,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

async function listSchedules() {
  const { rows } = await query(
    `SELECT * FROM scheduled_reports ORDER BY created_at DESC`,
  );
  return rows.map(shape);
}

async function getSchedule(id) {
  const { rows } = await query(`SELECT * FROM scheduled_reports WHERE id = $1`, [id]);
  if (!rows[0]) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Scheduled report not found.', {
      status: 404,
    });
  }
  return shape(rows[0]);
}

async function createSchedule(payload) {
  const {
    report_type,
    frequency,
    send_time = '08:00',
    day_of_week = null,
    day_of_month = null,
    recipients,
    format = 'pdf',
    filters = {},
    is_active = true,
    createdBy = null,
  } = payload;
  const { rows } = await query(
    `INSERT INTO scheduled_reports
       (report_type, frequency, send_time, day_of_week, day_of_month,
        recipients, format, filters, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      report_type,
      frequency,
      send_time,
      day_of_week,
      day_of_month,
      JSON.stringify(recipients),
      format,
      JSON.stringify(filters),
      is_active,
      createdBy,
    ],
  );
  return shape(rows[0]);
}

async function updateSchedule(id, patch) {
  const existing = await getSchedule(id);
  // Whitelist updatable fields so callers can't poison columns like
  // created_by / last_sent_at via PATCH.
  const allowed = [
    'report_type',
    'frequency',
    'send_time',
    'day_of_week',
    'day_of_month',
    'recipients',
    'format',
    'filters',
    'is_active',
  ];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    vals.push(
      k === 'recipients' || k === 'filters' ? JSON.stringify(patch[k]) : patch[k],
    );
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return existing;
  vals.push(id);
  const { rows } = await query(
    `UPDATE scheduled_reports SET ${sets.join(', ')}
      WHERE id = $${vals.length}
     RETURNING *`,
    vals,
  );
  return shape(rows[0]);
}

async function deleteSchedule(id) {
  const { rowCount } = await query(`DELETE FROM scheduled_reports WHERE id = $1`, [id]);
  if (!rowCount) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Scheduled report not found.', {
      status: 404,
    });
  }
  return { id, deleted: true };
}

// =======================================================================
// Execution
// =======================================================================
function ensureScheduledDir() {
  const dir = path.join(getUploadsRoot(), 'scheduled-reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function runSchedule(schedule, { io = null, actor = null } = {}) {
  const filters = schedule.filters || {};
  try {
    const data = await reportService.generateReport(schedule.report_type, filters);
    let exported;
    if (schedule.format === 'csv') {
      const body = await reportExporter.exportToCSV(data);
      const dir = ensureScheduledDir();
      const filename = `${schedule.report_type}-${Date.now()}.csv`;
      const abs = path.join(dir, filename);
      fs.writeFileSync(abs, Buffer.from(body, 'utf8'));
      exported = { absPath: abs, filename };
    } else if (schedule.format === 'excel' || schedule.format === 'xlsx') {
      exported = await reportExporter.exportToExcel(data);
    } else {
      exported = await reportExporter.exportToPDF(data, { user: actor });
    }

    // Move/copy into the dedicated scheduled-reports folder if the exporter
    // wrote elsewhere (Excel/PDF go to /uploads/reports by default).
    const scheduledDir = ensureScheduledDir();
    const finalPath = path.join(scheduledDir, exported.filename);
    if (exported.absPath !== finalPath) {
      try {
        fs.copyFileSync(exported.absPath, finalPath);
      } catch (err) {
        console.warn('[scheduledReportService] copy failed:', err.message);
      }
    }

    await query(
      `UPDATE scheduled_reports
          SET last_sent_at = NOW(), last_status = 'success'
        WHERE id = $1`,
      [schedule.id],
    );
    await logActivity({
      entityType: 'scheduled_report',
      entityId: schedule.id,
      action: 'scheduled_report.sent',
      performedBy: actor?.id || null,
      newValue: {
        report_type: schedule.report_type,
        format: schedule.format,
        recipients: schedule.recipients?.length || 0,
        file: exported.filename,
      },
    });

    // Notify recipients in real time. The email side is intentionally a TODO
    // — once SMTP is wired in we just attach the same file.
    if (io && Array.isArray(schedule.recipients)) {
      for (const rec of schedule.recipients) {
        if (!rec.employee_id) continue;
        io.to(`user:${rec.employee_id}`).emit('scheduled_report_ready', {
          scheduleId: schedule.id,
          reportType: schedule.report_type,
          filename: exported.filename,
        });
      }
    }
    return { ok: true, file: exported };
  } catch (err) {
    await query(
      `UPDATE scheduled_reports
          SET last_sent_at = NOW(), last_status = 'failed'
        WHERE id = $1`,
      [schedule.id],
    );
    await logActivity({
      entityType: 'scheduled_report',
      entityId: schedule.id,
      action: 'scheduled_report.failed',
      performedBy: actor?.id || null,
      notes: err.message,
    });
    console.error('[scheduledReportService] run failed:', err.message);
    throw err;
  }
}

async function runScheduleNow(id, user) {
  const schedule = await getSchedule(id);
  return runSchedule(schedule, { actor: user });
}

// =======================================================================
// Cron-like scheduler — fires daily at 08:00. We then filter which
// schedules should run today based on frequency/day-of-week/day-of-month.
// =======================================================================
let timer = null;

function msUntilNext(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

function shouldRunToday(schedule, today = new Date()) {
  if (!schedule.is_active) return false;
  if (schedule.frequency === 'daily') return true;
  if (schedule.frequency === 'weekly') {
    // JS getDay(): 0=Sun..6=Sat. Spec: 1=Mon..7=Sun.
    const dow = ((today.getDay() + 6) % 7) + 1;
    return Number(schedule.day_of_week) === dow;
  }
  if (schedule.frequency === 'monthly') {
    return Number(schedule.day_of_month) === today.getDate();
  }
  return false;
}

async function runScheduledReports({ io = null } = {}) {
  const list = await listSchedules();
  const eligible = list.filter((s) => shouldRunToday(s));
  let success = 0;
  let failure = 0;
  for (const s of eligible) {
    try {
      await runSchedule(s, { io });
      success += 1;
    } catch (_err) {
      failure += 1;
    }
  }
  console.log(`[scheduledReports] processed ${eligible.length} (ok=${success}, fail=${failure})`);
  return { processed: eligible.length, success, failure };
}

function schedule(io) {
  const delay = msUntilNext(8, 0);
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await runScheduledReports({ io });
    schedule(io);
  }, delay);
  const next = new Date(Date.now() + delay);
  console.log(`[scheduledReports] next run at ${next.toISOString()}`);
}

function startScheduledReportJob(io) {
  schedule(io);
}

module.exports = {
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  runScheduledReports,
  startScheduledReportJob,
  shouldRunToday,
};
