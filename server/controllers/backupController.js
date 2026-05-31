const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const { ok, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { query } = require('../db/postgres');
const { logActivity } = require('../utils/activityLog');

const backupService = require('../backup/backupService');
const nasDestination = require('../backup/destinations/nasDestination');
const usbDestination = require('../backup/destinations/usbDestination');
const retention = require('../backup/retention/retentionManager');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors?.[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

function shapeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    job_number: row.job_number,
    type: row.type,
    status: row.status,
    triggered_by: row.triggered_by,
    triggered_by_user: row.triggered_by_user,
    triggered_by_username: row.triggered_by_username || null,
    started_at: row.started_at,
    completed_at: row.completed_at,
    duration_seconds: row.duration_seconds,
    size_bytes: Number(row.size_bytes || 0),
    destinations: row.destinations || [],
    db_included: row.db_included,
    uploads_included: row.uploads_included,
    config_included: row.config_included,
    local_file_path: row.local_file_path,
    local_file_available:
      Boolean(row.local_file_path) && !row.deleted_at && fs.existsSync(row.local_file_path),
    error_message: row.error_message,
    deleted_at: row.deleted_at,
    notes: row.notes,
    created_at: row.created_at,
  };
}

// =======================================================================
// Jobs
// =======================================================================
async function listJobs(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 30, maxLimit: 100 });
    const type = req.query.type || null;
    const status = req.query.status || null;
    const where = [];
    const params = [];
    if (type) {
      params.push(type);
      where.push(`j.type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`j.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await query(
      `SELECT j.*, u.username AS triggered_by_username
         FROM backup_jobs j
         LEFT JOIN users u ON u.id = j.triggered_by_user
         ${whereSql}
        ORDER BY j.started_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const total = await query(
      `SELECT COUNT(*)::int AS count FROM backup_jobs j ${whereSql}`,
      params,
    );
    ok(res, rows.map(shapeJob), {
      pagination: { page, limit, total: total.rows[0].count },
    });
  } catch (err) {
    next(err);
  }
}

async function getJob(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT j.*, u.username AS triggered_by_username
         FROM backup_jobs j
         LEFT JOIN users u ON u.id = j.triggered_by_user
        WHERE j.id = $1`,
      [req.params.id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    ok(res, shapeJob(rows[0]));
  } catch (err) {
    next(err);
  }
}

// =======================================================================
// Run manual backup
// =======================================================================
const runSchema = z.object({
  type: z.enum(['full', 'db_only']).default('db_only'),
});

async function runManual(req, res, next) {
  try {
    const body = runSchema.parse(req.body || {});
    const scheduleKey = body.type === 'full' ? 'manual:full' : 'manual:db_only';
    // Kick off in background — return immediately so HTTP doesn't time out.
    backupService
      .runBackup({
        type: body.type,
        triggeredBy: 'manual',
        scheduleKey,
        userId: req.user.id,
      })
      .catch((err) => {
        if (err?.code !== 'BIZ_BACKUP_IN_PROGRESS') {
          console.warn('[backupController] manual backup failed', err.message);
        }
      });
    ok(res, { queued: true });
  } catch (err) {
    if (err.code === 'BIZ_BACKUP_IN_PROGRESS') {
      return next(
        new AppError(
          ERROR_CODES.BIZ_BACKUP_IN_PROGRESS,
          err.message,
          { status: 409 },
        ),
      );
    }
    next(err.errors ? zodFail(err) : err);
  }
}

// =======================================================================
// Restore — confirmation token must equal 'RESTORE'
// =======================================================================
const restoreSchema = z.object({
  confirm: z.literal('RESTORE'),
  confirmDelaySeconds: z.number().int().min(0).max(600).optional(),
});

async function restore(req, res, next) {
  try {
    restoreSchema.parse(req.body || {});
    if (req.user.role !== 'Admin') {
      throw new AppError(
        ERROR_CODES.AUTH_NO_PERMISSION,
        'Only an Admin can restore a backup.',
        { status: 403 },
      );
    }
    // Validate file exists before kicking off so we return 4xx (not 500)
    // when the operator picks an unavailable archive.
    const { rows } = await query(
      `SELECT * FROM backup_jobs WHERE id = $1`,
      [req.params.jobId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Backup job not found.', {
        status: 404,
      });
    }
    if (!rows[0].local_file_path || !fs.existsSync(rows[0].local_file_path)) {
      throw new AppError(
        ERROR_CODES.BIZ_BACKUP_FILE_MISSING,
        'Backup file is not available on the local disk.',
        { status: 409 },
      );
    }

    backupService
      .restoreFromBackup({
        jobId: req.params.jobId,
        userId: req.user.id,
        confirmDelaySeconds: Number(req.body?.confirmDelaySeconds ?? 120),
      })
      .catch((err) => {
        console.warn('[backupController] restore failed', err.message);
      });
    ok(res, { queued: true });
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

// =======================================================================
// Settings
// =======================================================================
const settingsSchema = z.object({
  schedule_6h_enabled: z.boolean().optional(),
  schedule_nightly_enabled: z.boolean().optional(),
  schedule_weekly_enabled: z.boolean().optional(),
  schedule_monthly_enabled: z.boolean().optional(),
  local_enabled: z.boolean().optional(),
  local_path: z.string().max(500).optional(),
  nas_enabled: z.boolean().optional(),
  nas_ip: z.string().max(50).nullable().optional(),
  nas_path: z.string().max(500).nullable().optional(),
  nas_username: z.string().max(100).nullable().optional(),
  nas_password: z.string().max(500).nullable().optional(),
  usb_enabled: z.boolean().optional(),
  usb_auto_detect: z.boolean().optional(),
  retention_6h_days: z.number().int().min(1).max(365).optional(),
  retention_nightly_days: z.number().int().min(1).max(365).optional(),
  retention_weekly_weeks: z.number().int().min(1).max(520).optional(),
  retention_monthly_months: z.number().int().min(1).max(600).optional(),
  notify_on_success: z.boolean().optional(),
  notify_on_failure: z.boolean().optional(),
  notify_user_ids: z.array(z.string().uuid()).optional(),
  compression_enabled: z.boolean().optional(),
  compression_level: z.number().int().min(1).max(9).optional(),
  encryption_enabled: z.boolean().optional(),
  pg_dump_path: z.string().max(500).nullable().optional(),
  pg_restore_path: z.string().max(500).nullable().optional(),
});

function getBackupKey() {
  const raw = process.env.MAHALI_BACKUP_SECRET;
  if (!raw) {
    throw new AppError(
      ERROR_CODES.CONFIGURATION_ERROR || 'CONFIGURATION_ERROR',
      'MAHALI_BACKUP_SECRET is not set — cannot encrypt NAS credentials.',
      { status: 500 },
    );
  }
  // Derive a 32-byte key from the secret (AES-256 requires exactly 32 bytes).
  return Buffer.from(raw.padEnd(32).slice(0, 32));
}

function encryptCredentials(value) {
  if (!value) return null;
  const key = getBackupKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  });
}

async function getSettings(req, res, next) {
  try {
    const s = await backupService.loadSettings();
    const sanitized = { ...s };
    if (sanitized.nas_password_encrypted) {
      sanitized.nas_password_set = true;
      delete sanitized.nas_password_encrypted;
    } else {
      sanitized.nas_password_set = false;
    }
    ok(res, sanitized);
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    const body = settingsSchema.parse(req.body || {});
    const fields = [];
    const params = [];
    const colMap = {
      schedule_6h_enabled: 'schedule_6h_enabled',
      schedule_nightly_enabled: 'schedule_nightly_enabled',
      schedule_weekly_enabled: 'schedule_weekly_enabled',
      schedule_monthly_enabled: 'schedule_monthly_enabled',
      local_enabled: 'local_enabled',
      local_path: 'local_path',
      nas_enabled: 'nas_enabled',
      nas_ip: 'nas_ip',
      nas_path: 'nas_path',
      nas_username: 'nas_username',
      usb_enabled: 'usb_enabled',
      usb_auto_detect: 'usb_auto_detect',
      retention_6h_days: 'retention_6h_days',
      retention_nightly_days: 'retention_nightly_days',
      retention_weekly_weeks: 'retention_weekly_weeks',
      retention_monthly_months: 'retention_monthly_months',
      notify_on_success: 'notify_on_success',
      notify_on_failure: 'notify_on_failure',
      compression_enabled: 'compression_enabled',
      compression_level: 'compression_level',
      encryption_enabled: 'encryption_enabled',
      pg_dump_path: 'pg_dump_path',
      pg_restore_path: 'pg_restore_path',
    };
    for (const [k, col] of Object.entries(colMap)) {
      if (body[k] !== undefined) {
        params.push(body[k]);
        fields.push(`${col} = $${params.length}`);
      }
    }
    if (body.notify_user_ids !== undefined) {
      params.push(JSON.stringify(body.notify_user_ids));
      fields.push(`notify_user_ids = $${params.length}::jsonb`);
    }
    if (body.nas_password !== undefined) {
      params.push(body.nas_password ? encryptCredentials(body.nas_password) : null);
      fields.push(`nas_password_encrypted = $${params.length}`);
    }
    if (!fields.length) {
      const s = await backupService.loadSettings();
      return ok(res, s);
    }
    fields.push(`updated_at = NOW()`);
    const sql = `UPDATE backup_settings SET ${fields.join(', ')}
                  WHERE id = (SELECT id FROM backup_settings ORDER BY updated_at DESC LIMIT 1)
                RETURNING *`;
    const { rows } = await query(sql, params);
    await logActivity({
      entityType: 'backup',
      action: 'backup.settings_updated',
      performedBy: req.user.id,
      newValue: { ...body, nas_password: body.nas_password ? '***' : undefined },
    });
    ok(res, rows[0]);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

// =======================================================================
// Disk + destinations + USB
// =======================================================================
async function diskUsage(req, res, next) {
  try {
    const usage = await backupService.diskUsage();
    ok(res, usage);
  } catch (err) {
    next(err);
  }
}

async function destinations(req, res, next) {
  try {
    const data = await backupService.destinationsHealth();
    ok(res, data);
  } catch (err) {
    next(err);
  }
}

const nasTestSchema = z.object({
  nas_ip: z.string().min(1),
  nas_path: z.string().min(1),
  nas_username: z.string().optional(),
  nas_password: z.string().optional(),
});

async function testNas(req, res, next) {
  try {
    const body = nasTestSchema.parse(req.body || {});
    const result = await nasDestination.testConnection({
      nasIp: body.nas_ip,
      nasPath: body.nas_path,
    });
    if (!result.ok) {
      return next(
        new AppError(
          ERROR_CODES.BIZ_NAS_CONNECTION_FAILED,
          result.error || 'NAS connection failed.',
          { status: 502 },
        ),
      );
    }
    ok(res, result);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function usbDrives(req, res, next) {
  try {
    const drives = await usbDestination.detectUSB();
    ok(res, drives);
  } catch (err) {
    next(err);
  }
}

// =======================================================================
// Download (only if local file is still present)
// =======================================================================
async function downloadJob(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT * FROM backup_jobs WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const job = rows[0];
    if (!job.local_file_path || !fs.existsSync(job.local_file_path)) {
      throw new AppError(
        ERROR_CODES.BIZ_BACKUP_FILE_MISSING,
        'Download not available — this backup is stored off-site only.',
        { status: 410 },
      );
    }
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${path.basename(job.local_file_path)}"`,
    );
    fs.createReadStream(job.local_file_path).pipe(res);
  } catch (err) {
    next(err);
  }
}

// =======================================================================
// Maintenance status (front-end uses this to detect restore-in-progress)
// =======================================================================
async function maintenanceStatus(req, res, next) {
  try {
    ok(res, backupService.maintenanceMode.status());
  } catch (err) {
    next(err);
  }
}

// =======================================================================
// Manual retention sweep
// =======================================================================
async function runRetentionCleanup(req, res, next) {
  try {
    const settings = await backupService.loadSettings();
    const result = await retention.cleanupAll(settings);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listJobs,
  getJob,
  runManual,
  restore,
  getSettings,
  updateSettings,
  diskUsage,
  destinations,
  testNas,
  usbDrives,
  downloadJob,
  maintenanceStatus,
  runRetentionCleanup,
};
