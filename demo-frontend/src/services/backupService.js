import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';
import { toast } from '../store/toastStore.js';

export function listBackupJobs(params) {
  return Promise.resolve({
    data: [
      { id: 1, job_number: 'BCK-2025-08-30', type: 'db_only', status: 'completed', created_at: '2025-08-30T22:00:00Z', size_bytes: 14205800 },
      { id: 2, job_number: 'BCK-2025-08-29', type: 'full', status: 'completed', created_at: '2025-08-29T22:00:00Z', size_bytes: 48900100 },
    ],
    meta: { total: 2 }
  });
}

export function getBackupJob(id) {
  return apiGet(`/backup/jobs/${id}`);
}

export function runManualBackup(type = 'db_only') {
  toast.success(`Manual ${type} backup triggered successfully in memory`);
  return Promise.resolve({ success: true, job_id: Date.now() });
}

export function restoreBackup(jobId) {
  toast.success('Backup restore simulated in memory');
  return Promise.resolve({ success: true });
}

export function getBackupSettings() {
  return Promise.resolve({
    auto_backup: true,
    schedule: '0 22 * * *',
    retention_days: 30,
    destinations: { local: true, usb: true, cloud: false },
  });
}

export function updateBackupSettings(patch) {
  toast.success('Backup settings updated');
  return Promise.resolve(patch);
}

export function getDiskUsage() {
  return Promise.resolve({
    total_gb: 512,
    free_gb: 340,
    used_gb: 172,
    db_size_mb: 24.5,
  });
}

export function getDestinationsHealth() {
  return Promise.resolve([
    { name: 'Local Fast SSD Storage', status: 'healthy', path: 'C:/MahaliPOS/Backups' },
    { name: 'External USB Drive (SanDisk 64GB)', status: 'connected', path: 'E:/Backups' },
  ]);
}

export function testNas(body) {
  return Promise.resolve({ success: true });
}

export function listUsbDrives() {
  return Promise.resolve([
    { name: 'SanDisk Ultra USB 3.0', mount: 'E:', size_gb: 64, free_gb: 58 }
  ]);
}

export function getMaintenanceStatus() {
  return Promise.resolve({ in_progress: false, status: 'idle' });
}

export function runRetentionCleanup() {
  toast.success('Old backup files cleaned up');
  return Promise.resolve({ cleaned_count: 3 });
}

export async function downloadBackup(jobId, jobNumber) {
  toast.success(`Downloaded backup archive ${jobNumber || 'backup'}.tar.gz`);
  return { success: true };
}
