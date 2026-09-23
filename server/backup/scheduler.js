const cron = require('node-cron');
const backupService = require('./backupService');
const { query } = require('../db/postgres');
const notificationService = require('../services/notificationService');

const tasks = [];

async function shouldRun(flagColumn) {
  try {
    const { rows } = await query(
      `SELECT ${flagColumn} FROM backup_settings ORDER BY updated_at DESC LIMIT 1`,
    );
    return Boolean(rows[0]?.[flagColumn]);
  } catch (_err) {
    return false;
  }
}

// A backup still holding the lock after this long is treated as stuck
// (e.g. a hung NAS copy) — it would otherwise block every later run.
const STUCK_AFTER_MS = 3 * 60 * 60 * 1000;

async function notifyAdmins({ title, message, dedupeKey = null }) {
  try {
    await notificationService.createNotification({
      type: 'system.backup_failed',
      category: 'system',
      severity: 'critical',
      title,
      message,
      referenceType: 'backup_job',
      actionUrl: '/settings/backup',
      targetRoles: ['Admin'],
      dedupeKey,
    });
  } catch (_e) { /* best-effort */ }
}

async function safeRun(label, scheduleKey, type, flagColumn) {
  if (flagColumn && !(await shouldRun(flagColumn))) return;
  try {
    await backupService.runBackup({
      type,
      triggeredBy: 'scheduled',
      scheduleKey,
    });
  } catch (err) {
    console.warn(`[backupScheduler] ${label} failed:`, err.message);
    if (err.code === 'BIZ_BACKUP_IN_PROGRESS') {
      // Overlapping schedules are normal; only a long-held lock is a problem.
      const running = err.runningJob;
      const age = running?.started_at ? Date.now() - new Date(running.started_at).getTime() : 0;
      if (age > STUCK_AFTER_MS) {
        await notifyAdmins({
          title: `Backup ${running.job_number} appears stuck`,
          message: `It has been running for ${Math.round(age / 3600000)}h, so the ${label} backup was skipped. Restart the server if it does not finish.`,
          dedupeKey: `backup.stuck.${running.id}`,
        });
      }
      return;
    }
    // Failures inside a started job already notified (err.notified); this
    // catches the rest — settings/DB errors before a job row existed —
    // which used to vanish into the console.
    if (!err.notified) {
      await notifyAdmins({
        title: `Scheduled ${label} backup could not start`,
        message: err.message || 'Unknown error.',
      });
    }
  }
}

function startBackupScheduler(io) {
  backupService.setIoInstance(io || null);
  if (process.env.MAHALI_DISABLE_BACKUP_SCHEDULER === '1') {
    console.log('[backupScheduler] disabled via env');
    return;
  }

  // A backup cut off by a crash/restart leaves its row at 'running'. Mark it
  // failed (and notify) now, rather than showing it as in progress forever.
  backupService.recoverInterruptedJobs().catch((err) => {
    console.warn('[backupScheduler] interrupted-job recovery failed', err.message);
  });

  // Every 6 hours — DB-only sweep.
  tasks.push(
    cron.schedule('0 */6 * * *', () =>
      safeRun('6h DB', '6h', 'db_only', 'schedule_6h_enabled'),
    ),
  );
  // Nightly full backup at 02:00.
  tasks.push(
    cron.schedule('0 2 * * *', () =>
      safeRun('nightly full', 'nightly', 'full', 'schedule_nightly_enabled'),
    ),
  );
  // Weekly archive on Sunday 03:00.
  tasks.push(
    cron.schedule('0 3 * * 0', () =>
      safeRun('weekly archive', 'weekly', 'full', 'schedule_weekly_enabled'),
    ),
  );
  // Monthly archive on the 1st at 04:00.
  tasks.push(
    cron.schedule('0 4 1 * *', () =>
      safeRun('monthly archive', 'monthly', 'full', 'schedule_monthly_enabled'),
    ),
  );
  // Daily disk-space check at 08:00.
  tasks.push(
    cron.schedule('0 8 * * *', async () => {
      try {
        await backupService.checkDiskSpace();
      } catch (err) {
        console.warn('[backupScheduler] disk check failed', err.message);
      }
    }),
  );

  console.log('[backupScheduler] schedules registered (6h / nightly / weekly / monthly + disk check).');
}

function stopBackupScheduler() {
  for (const t of tasks) {
    try { t.stop(); } catch (_e) { /* ignore */ }
  }
  tasks.length = 0;
}

module.exports = { startBackupScheduler, stopBackupScheduler, safeRun };
