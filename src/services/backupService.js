import { apiGet, apiPost, apiPut, apiGetWithMeta } from './http.js';
import { getApiBase } from '../config.js';
import { useAuthStore } from '../store/authStore.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function listBackupJobs(params) {
  return apiGetWithMeta(`/backup/jobs${qs(params)}`);
}
export function getBackupJob(id) {
  return apiGet(`/backup/jobs/${id}`);
}
export function runManualBackup(type = 'db_only') {
  return apiPost(`/backup/run`, { type });
}
export function restoreBackup(jobId, confirmDelaySeconds = 120) {
  return apiPost(`/backup/restore/${jobId}`, {
    confirm: 'RESTORE',
    confirmDelaySeconds,
  });
}
export function getBackupSettings() {
  return apiGet(`/backup/settings`);
}
export function updateBackupSettings(patch) {
  return apiPut(`/backup/settings`, patch);
}
export function getDiskUsage() {
  return apiGet(`/backup/disk-usage`);
}
export function getDestinationsHealth() {
  return apiGet(`/backup/destinations`);
}
export function testNas(body) {
  return apiPost(`/backup/test-nas`, body);
}
export function listUsbDrives() {
  return apiGet(`/backup/usb-drives`);
}
export function getMaintenanceStatus() {
  return apiGet(`/backup/status`);
}
export function runRetentionCleanup() {
  return apiPost(`/backup/retention/cleanup`, {});
}

// Download a backup archive. We hand the browser a real download dialog
// when running in a regular tab, and the Electron save-dialog when the
// preload bridge is available.
export async function downloadBackup(jobId, jobNumber) {
  const token = useAuthStore.getState().token;
  const url = `${getApiBase()}/backup/jobs/${jobId}/download`;
  const filename = `${jobNumber || 'backup'}.tar.gz`;
  const ipc = typeof window !== 'undefined' && window.electron;
  if (ipc && typeof ipc.backupDownload === 'function') {
    return ipc.backupDownload({ url, token, filename, jobId });
  }
  if (ipc && typeof ipc.downloadPdf === 'function') {
    return ipc.downloadPdf({ url, token, filename });
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(link.href);
  return { success: true };
}
