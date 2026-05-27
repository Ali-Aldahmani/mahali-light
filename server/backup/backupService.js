const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');

const { query, withTransaction } = require('../db/postgres');
const { logActivity } = require('../utils/activityLog');
const notificationService = require('../services/notificationService');

const dbBackup = require('./strategies/dbBackup');
const uploadsBackup = require('./strategies/uploadsBackup');
const configBackup = require('./strategies/configBackup');

const localDestination = require('./destinations/localDestination');
const nasDestination = require('./destinations/nasDestination');
const usbDestination = require('./destinations/usbDestination');

const maintenanceMode = require('./maintenanceMode');

// =======================================================================
// Schedule keys map to local-disk sub-directories AND drive retention.
// =======================================================================
const SCHEDULE_KEYS = {
  '6h': 'db-6h',
  nightly: 'full-nightly',
  weekly: 'full-weekly',
  monthly: 'full-monthly',
  'manual:full': 'manual-full',
  'manual:db_only': 'manual-db',
};

let ioInstance = null;
function setIoInstance(io) {
  ioInstance = io;
}

function emit(event, payload) {
  if (!ioInstance) return;
  try {
    if (event === 'restore_imminent' || event === 'restore_progress' || event === 'restore_completed') {
      ioInstance.emit(event, payload);
    } else {
      ioInstance.to('role:Admin').emit(event, payload);
      if (event === 'backup_failed' || event === 'disk_space_warning') {
        ioInstance.to('role:Manager').emit(event, payload);
      }
    }
  } catch (_err) {
    /* best-effort */
  }
}

async function loadSettings() {
  const { rows } = await query(
    `SELECT * FROM backup_settings ORDER BY updated_at DESC LIMIT 1`,
  );
  if (!rows.length) {
    const { rows: created } = await query(
      `INSERT INTO backup_settings (id) VALUES (gen_random_uuid()) RETURNING *`,
    );
    return created[0];
  }
  return rows[0];
}

// =======================================================================
// Job-number sequence — BKP-YYYY-NNNNN, per-year monotonic.
// =======================================================================
async function nextJobNumber() {
  return withTransaction(async (client) => {
    const year = new Date().getFullYear();
    const { rows } = await client.query(
      `INSERT INTO document_sequences (doc_type, year, scope, last_value)
       VALUES ('BKP', $1, '', 1)
       ON CONFLICT (doc_type, year, scope)
       DO UPDATE SET last_value = document_sequences.last_value + 1
       RETURNING last_value`,
      [year],
    );
    const n = String(rows[0].last_value).padStart(5, '0');
    return `BKP-${year}-${n}`;
  });
}

function timestampForFile() {
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function tempJobDir(jobId) {
  const dir = path.join(os.tmpdir(), 'mahali-backups', jobId);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

async function safeRm(p) {
  if (!p) return;
  try {
    await fs.promises.rm(p, { recursive: true, force: true });
  } catch (_e) {
    /* ignore */
  }
}

// Are we already running a backup? The spec forbids two in flight.
async function anyRunning() {
  const { rows } = await query(
    `SELECT id, job_number FROM backup_jobs WHERE status = 'running' LIMIT 1`,
  );
  return rows[0] || null;
}

// =======================================================================
// Run a backup.
//   type:        'full' | 'db_only'
//   triggeredBy: 'scheduled' | 'manual'
//   scheduleKey: '6h' | 'nightly' | 'weekly' | 'monthly' | 'manual:full' | 'manual:db_only'
//   userId:      uuid (manual only)
// =======================================================================
async function runBackup({ type, triggeredBy, scheduleKey, userId = null }) {
  const running = await anyRunning();
  if (running) {
    const err = new Error(`Backup already in progress (${running.job_number}).`);
    err.code = 'BIZ_BACKUP_IN_PROGRESS';
    throw err;
  }
  const settings = await loadSettings();
  const compressionLevel = settings.compression_enabled ? settings.compression_level : 0;

  const jobNumber = await nextJobNumber();
  const { rows: created } = await query(
    `INSERT INTO backup_jobs
       (job_number, type, status, triggered_by, triggered_by_user,
        db_included, uploads_included, config_included)
     VALUES ($1,$2,'running',$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      jobNumber,
      type,
      triggeredBy,
      userId,
      true,
      type === 'full',
      type === 'full',
    ],
  );
  const job = created[0];
  emit('backup_started', { jobId: job.id, jobNumber, type, triggeredBy });

  const startedAt = Date.now();
  const tempDir = await tempJobDir(job.id);
  const timestamp = timestampForFile();
  const archiveName = `${type === 'full' ? 'full' : 'db'}-${timestamp}.tar.gz`;
  let finalArchivePath = null;
  const destinationResults = [];
  let errorMessage = null;
  let strategiesSucceeded = false;

  try {
    // -------------------- 1. Strategies --------------------
    const dbOut = path.join(tempDir, `${timestamp}-db.dump`);
    await dbBackup.backupDatabase(dbOut, { pgDumpPath: settings.pg_dump_path });
    const componentPaths = [dbOut];

    if (type === 'full') {
      try {
        const uploadsOut = path.join(tempDir, `${timestamp}-uploads.zip`);
        await uploadsBackup.backupUploads(uploadsOut, { compressionLevel });
        componentPaths.push(uploadsOut);
      } catch (err) {
        console.warn('[backupService] uploads backup failed', err.message);
        // We continue — partial backup is still useful.
        errorMessage = `uploads: ${err.message}`;
      }
      try {
        const configOut = path.join(tempDir, `${timestamp}-config.zip`);
        await configBackup.backupConfig(configOut, { compressionLevel });
        componentPaths.push(configOut);
      } catch (err) {
        console.warn('[backupService] config backup failed', err.message);
        errorMessage = `${errorMessage ? errorMessage + ' | ' : ''}config: ${err.message}`;
      }
    }

    // -------------------- 2. Package into archive --------------------
    finalArchivePath = path.join(tempDir, archiveName);
    await tar.c(
      {
        gzip: { level: compressionLevel || 1 },
        file: finalArchivePath,
        cwd: tempDir,
      },
      componentPaths.map((p) => path.basename(p)),
    );
    strategiesSucceeded = true;

    // -------------------- 3. Save to destinations --------------------
    const dests = [];
    if (settings.local_enabled) {
      dests.push(
        localDestination.save(finalArchivePath, archiveName, SCHEDULE_KEYS[scheduleKey] || scheduleKey, {
          localPath: settings.local_path,
        }),
      );
    }
    if (settings.nas_enabled) {
      dests.push(
        nasDestination.save(finalArchivePath, archiveName, SCHEDULE_KEYS[scheduleKey] || scheduleKey, {
          nasIp: settings.nas_ip,
          nasPath: settings.nas_path,
        }),
      );
    }
    if (settings.usb_enabled) {
      dests.push(usbDestination.save(finalArchivePath, archiveName, SCHEDULE_KEYS[scheduleKey] || scheduleKey));
    }
    const settled = await Promise.all(dests);
    destinationResults.push(...settled);

    // -------------------- 4. Determine status --------------------
    const anySucceeded = destinationResults.some((d) => d.success);
    const anyFailed = destinationResults.some((d) => !d.success);
    const status = anySucceeded
      ? (anyFailed || errorMessage ? 'partial' : 'completed')
      : 'failed';
    const sizeStat = await fs.promises.stat(finalArchivePath).catch(() => null);
    const localResult = destinationResults.find((d) => d.type === 'local' && d.success);

    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    await query(
      `UPDATE backup_jobs
          SET status = $1,
              completed_at = NOW(),
              duration_seconds = $2,
              size_bytes = $3,
              destinations = $4::jsonb,
              local_file_path = $5,
              error_message = $6
        WHERE id = $7`,
      [
        status,
        durationSeconds,
        sizeStat?.size || 0,
        JSON.stringify(destinationResults),
        localResult?.path || null,
        errorMessage,
        job.id,
      ],
    );

    await logActivity({
      entityType: 'backup',
      entityId: job.id,
      action:
        triggeredBy === 'scheduled'
          ? 'backup.scheduled_started'
          : 'backup.manual_started',
      performedBy: userId,
      newValue: { jobNumber, type, scheduleKey },
    });
    await logActivity({
      entityType: 'backup',
      entityId: job.id,
      action: status === 'failed' ? 'backup.failed' : 'backup.completed',
      performedBy: userId,
      newValue: { status, sizeBytes: sizeStat?.size || 0, durationSeconds },
    });

    // -------------------- 5. Notifications --------------------
    if (status === 'failed' || destinationResults.some((d) => !d.success)) {
      await notifyFailure({ settings, job, jobNumber, type, destinationResults });
      emit('backup_failed', {
        jobId: job.id,
        jobNumber,
        type,
        error: errorMessage || destinationResults.find((d) => !d.success)?.error,
        destinations: destinationResults,
      });
    } else if (status === 'completed' && settings.notify_on_success) {
      await notifySuccess({ settings, job, jobNumber, type, sizeBytes: sizeStat?.size || 0 });
    }
    emit('backup_completed', {
      jobId: job.id,
      jobNumber,
      type,
      status,
      sizeBytes: sizeStat?.size || 0,
      destinations: destinationResults,
    });

    // -------------------- 6. Retention cleanup --------------------
    try {
      const retention = require('./retention/retentionManager');
      await retention.cleanupAll(settings).catch(() => {});
    } catch (_e) {
      /* best-effort */
    }

    return { jobId: job.id, jobNumber, status };
  } catch (err) {
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    await query(
      `UPDATE backup_jobs
          SET status = 'failed',
              completed_at = NOW(),
              duration_seconds = $1,
              error_message = $2,
              destinations = $3::jsonb
        WHERE id = $4`,
      [
        durationSeconds,
        err.message,
        JSON.stringify(destinationResults),
        job.id,
      ],
    );
    await logActivity({
      entityType: 'backup',
      entityId: job.id,
      action: 'backup.failed',
      performedBy: userId,
      newValue: { error: err.message, after: strategiesSucceeded ? 'archive_or_destinations' : 'strategies' },
    });
    await notifyFailure({ settings, job, jobNumber, type, destinationResults, message: err.message });
    emit('backup_failed', {
      jobId: job.id,
      jobNumber,
      type,
      error: err.message,
      destinations: destinationResults,
    });
    throw err;
  } finally {
    await safeRm(tempDir);
  }
}

async function notifyFailure({ settings, job, jobNumber, type, destinationResults, message = null }) {
  const failures = destinationResults.filter((d) => !d.success);
  const baseMessage = failures.length
    ? `Failed destinations: ${failures.map((f) => `${f.type} (${f.error || 'error'})`).join(', ')}`
    : (message || 'Backup failed.');
  try {
    if (settings.notify_on_failure) {
      const userIds = Array.isArray(settings.notify_user_ids) && settings.notify_user_ids.length
        ? settings.notify_user_ids
        : null;
      await notificationService.createNotification({
        type: 'system.backup_failed',
        category: 'system',
        severity: 'critical',
        title: `Backup ${jobNumber} failed`,
        message: baseMessage,
        referenceType: 'backup_job',
        referenceId: job.id,
        actionUrl: '/settings/backup',
        targetRoles: userIds ? null : ['Admin'],
        targetUserIds: userIds,
      });
    }
  } catch (_e) { /* best-effort */ }
}

async function notifySuccess({ settings, job, jobNumber, type, sizeBytes }) {
  try {
    const userIds = Array.isArray(settings.notify_user_ids) && settings.notify_user_ids.length
      ? settings.notify_user_ids
      : null;
    await notificationService.createNotification({
      type: 'system.backup_success',
      category: 'system',
      severity: 'info',
      title: `Backup ${jobNumber} completed`,
      message: `${type === 'full' ? 'Full' : 'Database-only'} backup — ${formatBytes(sizeBytes)}.`,
      referenceType: 'backup_job',
      referenceId: job.id,
      actionUrl: '/settings/backup',
      targetRoles: userIds ? null : ['Admin'],
      targetUserIds: userIds,
    });
  } catch (_e) { /* best-effort */ }
}

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  if (x < 1024 * 1024 * 1024) return `${(x / 1024 / 1024).toFixed(1)} MB`;
  return `${(x / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// =======================================================================
// Restore — admin-only, takes the whole API into maintenance mode.
// =======================================================================
async function restoreFromBackup({ jobId, userId, confirmDelaySeconds = 120 }) {
  const { rows } = await query(
    `SELECT * FROM backup_jobs WHERE id = $1`,
    [jobId],
  );
  if (!rows.length) {
    const err = new Error('Backup job not found.');
    err.code = 'BIZ_BACKUP_FILE_MISSING';
    throw err;
  }
  const job = rows[0];
  if (job.status !== 'completed' && job.status !== 'partial') {
    const err = new Error(`This backup is in '${job.status}' state and cannot be restored.`);
    err.code = 'BIZ_BACKUP_RESTORE_BLOCKED';
    throw err;
  }
  const filePath = job.local_file_path;
  if (!filePath || !fs.existsSync(filePath)) {
    const err = new Error(
      'Backup file is not available on the local disk. Copy it back before restoring.',
    );
    err.code = 'BIZ_BACKUP_FILE_MISSING';
    throw err;
  }

  // -------------------- Step 1: warn users --------------------
  emit('restore_imminent', { startsIn: confirmDelaySeconds, jobId });
  await logActivity({
    entityType: 'backup',
    entityId: jobId,
    action: 'backup.restore_started',
    performedBy: userId,
    newValue: { jobNumber: job.job_number },
  });
  await sleep(confirmDelaySeconds * 1000);

  // -------------------- Step 2: maintenance mode --------------------
  maintenanceMode.enable('System restore in progress — please wait.');
  emit('restore_progress', { step: 'extract', percent: 10, message: 'Extracting backup archive…' });

  const restoreDir = path.join(os.tmpdir(), 'mahali-restore', jobId);
  try {
    await fs.promises.mkdir(restoreDir, { recursive: true });
    await tar.x({ file: filePath, cwd: restoreDir });
    const files = await fs.promises.readdir(restoreDir);
    const dumpFile = files.find((f) => f.endsWith('-db.dump'));
    if (!dumpFile) throw new Error('No database dump inside backup archive.');

    // -------------------- Step 3: restore DB --------------------
    emit('restore_progress', { step: 'database', percent: 40, message: 'Restoring database…' });
    const settings = await loadSettings();
    const dbResult = await dbBackup.restoreDatabase(
      path.join(restoreDir, dumpFile),
      { pgRestorePath: settings.pg_restore_path },
    );
    if (!dbResult.success) {
      throw new Error(`Database restore failed: ${dbResult.error || 'unknown'}`);
    }

    // -------------------- Step 4: uploads (if present) --------------------
    const uploadsFile = files.find((f) => f.endsWith('-uploads.zip'));
    if (uploadsFile) {
      emit('restore_progress', { step: 'uploads', percent: 75, message: 'Restoring uploads…' });
      try {
        await extractZip(path.join(restoreDir, uploadsFile), uploadsBackup.uploadsDir());
      } catch (err) {
        console.warn('[restore] uploads restore failed', err.message);
      }
    }

    // -------------------- Step 5: announce success --------------------
    emit('restore_progress', { step: 'finalize', percent: 95, message: 'Finalizing…' });
    await logActivity({
      entityType: 'backup',
      entityId: jobId,
      action: 'backup.restore_completed',
      performedBy: userId,
      newValue: { jobNumber: job.job_number },
    });
    emit('restore_completed', { jobId });
    emit('restore_progress', { step: 'done', percent: 100, message: 'Restore complete.' });
    // Stay in maintenance mode until the operator restarts the server (the
    // spec uses pm2 to manage this). We disable here so a manual run still
    // recovers when pm2 is not in play.
    setTimeout(() => maintenanceMode.disable(), 3000);
    return { ok: true };
  } catch (err) {
    maintenanceMode.disable();
    await logActivity({
      entityType: 'backup',
      entityId: jobId,
      action: 'backup.restore_failed',
      performedBy: userId,
      notes: err.message,
    });
    emit('restore_progress', { step: 'error', percent: 0, message: err.message });
    throw err;
  } finally {
    await safeRm(restoreDir);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractZip(zipPath, destDir) {
  // We avoid pulling in unzipper for one operation — instead use yauzl style
  // via node's built-in capability through the `tar` package would be wrong
  // here. Use a minimal stream-based extractor using the same `archiver`
  // counterpart `unzipper` would normally provide. Fallback to system unzip
  // when available; otherwise rely on node:fs and zlib.
  const unzipper = await tryRequire('unzipper');
  if (unzipper) {
    await new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: destDir }))
        .on('close', resolve)
        .on('error', reject);
    });
    return;
  }
  // Fallback: shell out to `tar -xf` which on modern Windows + most Unix
  // distros handles zip natively. If it fails, propagate the error.
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn('tar', ['-xf', zipPath, '-C', destDir]);
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(null);
      else reject(new Error(`tar -xf exited with code ${code}`));
    });
  });
}

function tryRequire(name) {
  try {
    return Promise.resolve(require(name));
  } catch (_e) {
    return Promise.resolve(null);
  }
}

// =======================================================================
// Disk-space helpers
// =======================================================================
async function diskUsage() {
  // statfs is available on Node 18+. Fall back to a generous 'unknown' value
  // when not supported so the dashboard still renders.
  const target = path.resolve(process.cwd());
  try {
    if (typeof fs.statfs === 'function') {
      const st = await fs.promises.statfs(target);
      const totalBytes = Number(st.blocks) * Number(st.bsize);
      const freeBytes = Number(st.bavail) * Number(st.bsize);
      const usedBytes = totalBytes - freeBytes;
      return {
        path: target,
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
      };
    }
  } catch (_e) {
    /* fall through */
  }
  return { path: target, totalBytes: null, freeBytes: null, usedBytes: null, usedPercent: null };
}

async function destinationsHealth() {
  const settings = await loadSettings();
  const local = {
    enabled: settings.local_enabled,
    type: 'local',
    path: localDestination.resolveBaseDir(settings.local_path),
  };
  try {
    if (settings.local_enabled) {
      await fs.promises.mkdir(local.path, { recursive: true });
      local.ok = true;
    }
  } catch (err) {
    local.ok = false;
    local.error = err.message;
  }
  const nas = settings.nas_enabled
    ? { enabled: true, type: 'nas', ...(await nasDestination.testConnection({ nasIp: settings.nas_ip, nasPath: settings.nas_path })) }
    : { enabled: false, type: 'nas' };
  const usbDrives = settings.usb_enabled ? await usbDestination.detectUSB() : [];
  const usb = {
    enabled: settings.usb_enabled,
    type: 'usb',
    detected: usbDrives.length,
    drives: usbDrives,
    ok: settings.usb_enabled ? usbDrives.length > 0 : null,
  };
  return { local, nas, usb };
}

async function checkDiskSpace() {
  const usage = await diskUsage();
  if (usage.usedPercent == null) return usage;
  if (usage.usedPercent >= 95 || (usage.freeBytes != null && usage.freeBytes < 5 * 1024 * 1024 * 1024)) {
    emit('disk_space_warning', {
      usedPercent: usage.usedPercent,
      freeBytes: usage.freeBytes,
      severity: 'critical',
    });
    try {
      await notificationService.notifyRoles(['Admin'], {
        type: 'system.disk_low',
        category: 'system',
        severity: 'critical',
        title: `Disk almost full (${usage.usedPercent}%)`,
        message: `Only ${formatBytes(usage.freeBytes)} free on ${usage.path}. Consider running retention cleanup or expanding storage.`,
        dedupeKey: `system.disk_low.critical`,
        actionUrl: '/settings/backup',
      });
    } catch (_e) { /* best-effort */ }
  } else if (usage.usedPercent >= 85) {
    emit('disk_space_warning', {
      usedPercent: usage.usedPercent,
      freeBytes: usage.freeBytes,
      severity: 'warning',
    });
    try {
      await notificationService.notifyRoles(['Admin'], {
        type: 'system.disk_low',
        category: 'system',
        severity: 'warning',
        title: `Disk usage at ${usage.usedPercent}%`,
        message: `${formatBytes(usage.freeBytes)} free. Plan a cleanup soon.`,
        dedupeKey: `system.disk_low.warning`,
        actionUrl: '/settings/backup',
      });
    } catch (_e) { /* best-effort */ }
  }
  return usage;
}

module.exports = {
  setIoInstance,
  loadSettings,
  runBackup,
  restoreFromBackup,
  diskUsage,
  destinationsHealth,
  checkDiskSpace,
  formatBytes,
  SCHEDULE_KEYS,
  maintenanceMode,
};
