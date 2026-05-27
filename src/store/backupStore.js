import { create } from 'zustand';
import * as api from '../services/backupService.js';
import { toast } from './toastStore.js';

export const useBackupStore = create((set, get) => ({
  jobs: [],
  jobsMeta: null,
  loadingJobs: false,
  settings: null,
  loadingSettings: false,
  destinations: null,
  diskUsage: null,
  usbDrives: [],
  maintenance: { active: false, reason: null, since: null },
  restoreImminent: null, // { startsIn, jobId, startedAt }
  restoreProgress: null, // { step, percent, message }

  // ---- Loaders ----
  fetchJobs: async (params = {}) => {
    set({ loadingJobs: true });
    try {
      const res = await api.listBackupJobs({ limit: 30, ...params });
      set({ jobs: res?.data || [], jobsMeta: res?.meta || null });
    } catch (err) {
      toast.error(err.message || 'Could not load backup history.');
    } finally {
      set({ loadingJobs: false });
    }
  },

  fetchSettings: async () => {
    set({ loadingSettings: true });
    try {
      const s = await api.getBackupSettings();
      set({ settings: s });
    } catch (err) {
      toast.error(err.message || 'Could not load backup settings.');
    } finally {
      set({ loadingSettings: false });
    }
  },

  fetchDestinations: async () => {
    try {
      const d = await api.getDestinationsHealth();
      set({ destinations: d });
    } catch (_e) { /* silent */ }
  },

  fetchDiskUsage: async () => {
    try {
      const d = await api.getDiskUsage();
      set({ diskUsage: d });
    } catch (_e) { /* silent */ }
  },

  fetchUsbDrives: async () => {
    try {
      const d = await api.listUsbDrives();
      set({ usbDrives: Array.isArray(d) ? d : [] });
    } catch (_e) { /* silent */ }
  },

  fetchMaintenance: async () => {
    try {
      const s = await api.getMaintenanceStatus();
      set({
        maintenance: {
          active: Boolean(s?.active),
          reason: s?.reason || null,
          since: s?.since || null,
        },
      });
    } catch (_e) { /* silent */ }
  },

  // ---- Actions ----
  runBackup: async (type) => {
    try {
      await api.runManualBackup(type);
      toast.success(
        type === 'full' ? 'Full backup started.' : 'Database backup started.',
      );
      // Refresh shortly after — the job goes to 'running' and we want to
      // surface that immediately in the table.
      setTimeout(() => get().fetchJobs(), 1500);
    } catch (err) {
      toast.error(err.message || 'Could not start backup.');
      throw err;
    }
  },

  saveSettings: async (patch) => {
    try {
      const s = await api.updateBackupSettings(patch);
      set({ settings: s });
      toast.success('Backup settings saved.');
      return s;
    } catch (err) {
      toast.error(err.message || 'Could not save settings.');
      throw err;
    }
  },

  testNasConnection: async (body) => {
    try {
      const r = await api.testNas(body);
      toast.success('NAS connection OK.');
      return { ok: true, ...r };
    } catch (err) {
      toast.error(`NAS connection failed: ${err.message || 'unknown'}`);
      return { ok: false, error: err.message };
    }
  },

  triggerRestore: async (jobId, delay = 120) => {
    try {
      await api.restoreBackup(jobId, delay);
      toast.success('Restore queued.');
    } catch (err) {
      toast.error(err.message || 'Restore failed to start.');
      throw err;
    }
  },

  cleanupRetention: async () => {
    try {
      const r = await api.runRetentionCleanup();
      toast.success(
        r?.deleted
          ? `Retention sweep deleted ${r.deleted} old backup${r.deleted === 1 ? '' : 's'}.`
          : 'Nothing to clean up.',
      );
    } catch (err) {
      toast.error(err.message || 'Cleanup failed.');
    }
  },

  // ---- Socket integration ----
  onBackupStarted: (payload) => {
    set({ jobs: get().jobs }); // forces refresh hook
    get().fetchJobs();
  },
  onBackupCompleted: (_payload) => {
    get().fetchJobs();
    get().fetchDiskUsage();
  },
  onBackupFailed: (_payload) => {
    get().fetchJobs();
  },
  onRestoreImminent: (payload) => {
    set({
      restoreImminent: {
        startsIn: Number(payload?.startsIn) || 120,
        startedAt: Date.now(),
        jobId: payload?.jobId,
      },
    });
  },
  onRestoreProgress: (payload) => {
    set({
      maintenance: { ...get().maintenance, active: true, reason: payload?.message || 'Restore in progress' },
      restoreProgress: {
        step: payload?.step,
        percent: Number(payload?.percent) || 0,
        message: payload?.message || '',
      },
    });
  },
  onRestoreCompleted: () => {
    set({
      restoreImminent: null,
      restoreProgress: { step: 'done', percent: 100, message: 'Restore complete.' },
    });
    // Give the server a beat to disable maintenance, then refresh.
    setTimeout(() => {
      set({ maintenance: { active: false, reason: null, since: null } });
      get().fetchJobs();
    }, 3000);
  },
  onDiskWarning: (payload) => {
    if (!payload) return;
    if (payload.severity === 'critical') {
      toast.error(`Disk almost full (${payload.usedPercent}%)`);
    } else {
      toast.warning(`Disk usage high (${payload.usedPercent}%)`);
    }
    get().fetchDiskUsage();
  },
}));
