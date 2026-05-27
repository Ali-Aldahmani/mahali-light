const path = require('path');
const fs = require('fs');
const { query } = require('../../db/postgres');
const { logActivity } = require('../../utils/activityLog');
const localDestination = require('../destinations/localDestination');

// We cap retention by *days* (the spec) per schedule. Monthly archives are
// kept forever — that policy is hard-coded so misconfiguration can never
// erase a permanent record.
function retentionDaysFor(scheduleKey, settings) {
  switch (scheduleKey) {
    case 'db-6h':
      return Number(settings.retention_6h_days) || 7;
    case 'db-nightly':
    case 'full-nightly':
      return Number(settings.retention_nightly_days) || 30;
    case 'full-weekly':
      return Math.max(7, Number(settings.retention_weekly_weeks || 12) * 7);
    case 'full-monthly':
      return Infinity;
    case 'manual-full':
    case 'manual-db':
      // Manual archives are kept until the operator removes them.
      return Infinity;
    default:
      return Infinity;
  }
}

async function cleanupAll(settings) {
  const buckets = await localDestination.listFilesByType(settings.local_path);
  let deleted = 0;
  const cutoffNow = Date.now();

  for (const [scheduleKey, files] of Object.entries(buckets)) {
    const retentionDays = retentionDaysFor(scheduleKey, settings);
    if (!Number.isFinite(retentionDays)) continue;
    const cutoff = cutoffNow - retentionDays * 24 * 60 * 60 * 1000;
    for (const f of files) {
      if (!f.mtime) continue;
      if (new Date(f.mtime).getTime() < cutoff) {
        const result = await localDestination.deleteFile(f.path);
        if (result.success) {
          deleted += 1;
          // Mark any matching backup_jobs rows as deleted so the UI doesn't
          // try to offer them for download.
          await query(
            `UPDATE backup_jobs
                SET deleted_at = NOW()
              WHERE local_file_path = $1`,
            [f.path],
          ).catch(() => {});
        }
      }
    }
  }
  if (deleted > 0) {
    await logActivity({
      entityType: 'backup',
      action: 'backup.retention_cleanup',
      newValue: { deletedCount: deleted },
    });
  }
  return { deleted };
}

module.exports = { cleanupAll, retentionDaysFor };
