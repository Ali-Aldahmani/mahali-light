const cron = require('node-cron');
const backupService = require('./backupService');
const { query } = require('../db/postgres');

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
  }
}

function startBackupScheduler(io) {
  backupService.setIoInstance(io || null);
  if (process.env.MAHALI_DISABLE_BACKUP_SCHEDULER === '1') {
    console.log('[backupScheduler] disabled via env');
    return;
  }

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

module.exports = { startBackupScheduler, stopBackupScheduler };
