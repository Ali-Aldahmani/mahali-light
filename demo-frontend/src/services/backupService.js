import { toast } from '../store/toastStore.js';

// This module is a fully self-contained, in-memory mock — it never touches
// mockApi.js/handleMockRequest. Field names below are chosen to match what
// BackupStatusCard, BackupJobRow, DiskUsageBar and DestinationStatusBadge
// actually read (verified against those components directly).

const JOBS = [
  {
    id: 1,
    job_number: 'BCK-2025-08-30',
    type: 'db_only',
    status: 'completed',
    started_at: '2025-08-30T22:00:00Z',
    duration_seconds: 42,
    size_bytes: 14205800,
    triggered_by_username: 'System (scheduled)',
    destinations: [
      { type: 'local', ok: true },
      { type: 'usb', ok: true },
    ],
    error_message: null,
    local_file_available: true,
  },
  {
    id: 2,
    job_number: 'BCK-2025-08-29',
    type: 'full',
    status: 'completed',
    started_at: '2025-08-29T22:00:00Z',
    duration_seconds: 118,
    size_bytes: 48900100,
    triggered_by_username: 'System (scheduled)',
    destinations: [
      { type: 'local', ok: true },
      { type: 'usb', ok: true },
    ],
    error_message: null,
    local_file_available: true,
  },
  {
    id: 3,
    job_number: 'BCK-2025-08-23',
    type: 'full',
    status: 'completed',
    started_at: '2025-08-23T22:00:00Z',
    duration_seconds: 121,
    size_bytes: 47800300,
    triggered_by_username: 'Rashid Al Nuaimi (manual)',
    destinations: [
      { type: 'local', ok: true },
      { type: 'usb', ok: false },
    ],
    error_message: null,
    local_file_available: true,
  },
];

let SETTINGS = {
  schedule_6h_enabled: true,
  schedule_nightly_enabled: true,
  schedule_weekly_enabled: true,
  schedule_monthly_enabled: true,
  local_enabled: true,
  local_path: './backups',
  nas_enabled: false,
  nas_ip: '',
  nas_path: '',
  nas_username: '',
  nas_password_set: false,
  usb_enabled: true,
  usb_auto_detect: true,
  retention_6h_days: 7,
  retention_nightly_days: 30,
  retention_weekly_weeks: 12,
  notify_on_success: false,
  notify_on_failure: true,
  compression_enabled: true,
  compression_level: 6,
  encryption_enabled: false,
  pg_dump_path: '',
  pg_restore_path: '',
};

export function listBackupJobs() {
  return Promise.resolve({ data: JOBS, meta: { total: JOBS.length } });
}

export function getBackupJob(id) {
  return Promise.resolve(JOBS.find((j) => String(j.id) === String(id)) || null);
}

export function runManualBackup(type = 'db_only') {
  const job = {
    id: Date.now(),
    job_number: `BCK-${new Date().toISOString().slice(0, 10)}`,
    type,
    status: 'completed',
    started_at: new Date().toISOString(),
    duration_seconds: type === 'full' ? 110 : 38,
    size_bytes: type === 'full' ? 49200000 : 14500000,
    triggered_by_username: 'Rashid Al Nuaimi (manual)',
    destinations: [{ type: 'local', ok: true }, { type: 'usb', ok: SETTINGS.usb_enabled }],
    error_message: null,
    local_file_available: true,
  };
  JOBS.unshift(job);
  toast.success(`Manual ${type === 'full' ? 'full' : 'database'} backup completed.`);
  return Promise.resolve({ success: true, job_id: job.id });
}

export function restoreBackup(jobId) {
  toast.success('Backup restore simulated in memory.');
  return Promise.resolve({ success: true });
}

export function getBackupSettings() {
  return Promise.resolve({ ...SETTINGS });
}

export function updateBackupSettings(patch) {
  SETTINGS = { ...SETTINGS, ...patch };
  if (patch.nas_password) SETTINGS.nas_password_set = true;
  return Promise.resolve({ ...SETTINGS });
}

export function getDiskUsage() {
  const totalBytes = 512 * 1024 * 1024 * 1024;
  const usedBytes = 172 * 1024 * 1024 * 1024;
  return Promise.resolve({
    totalBytes,
    usedBytes,
    freeBytes: totalBytes - usedBytes,
    usedPercent: Math.round((usedBytes / totalBytes) * 100),
  });
}

export function getDestinationsHealth() {
  return Promise.resolve({
    local: { type: 'local', enabled: SETTINGS.local_enabled, ok: true, path: SETTINGS.local_path || './backups' },
    nas: { type: 'nas', enabled: SETTINGS.nas_enabled, ok: SETTINGS.nas_enabled ? false : null, path: SETTINGS.nas_path, error: SETTINGS.nas_enabled ? 'Not reachable' : null },
    usb: { type: 'usb', enabled: SETTINGS.usb_enabled, ok: SETTINGS.usb_enabled, detected: SETTINGS.usb_enabled ? 1 : 0 },
  });
}

export function testNas(body) {
  return Promise.resolve({ success: true });
}

export function listUsbDrives() {
  return Promise.resolve([
    { device: 'usb0', description: 'SanDisk Ultra USB 3.0', mountpoint: 'E:/', size_gb: 64, free_gb: 58 },
  ]);
}

export function getMaintenanceStatus() {
  return Promise.resolve({ active: false, reason: null, since: null });
}

export function runRetentionCleanup() {
  toast.success('Old backup files cleaned up.');
  return Promise.resolve({ deleted: 3 });
}

export async function downloadBackup(jobId, jobNumber) {
  toast.success(`Downloaded backup archive ${jobNumber || 'backup'}.tar.gz`);
  return { success: true };
}
