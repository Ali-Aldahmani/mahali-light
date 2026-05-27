import { create } from 'zustand';
import { API_BASE } from '../config.js';

export const useOfflineStore = create((set, get) => ({
  isOffline: false,
  offlineSince: null,
  queuedCount: 0,
  checkTimer: null,

  setOffline: (offline = true) => {
    set((s) => ({
      isOffline: offline,
      offlineSince: offline ? s.offlineSince || new Date().toISOString() : null,
    }));
  },

  setQueuedCount: (n) => set({ queuedCount: Number(n) || 0 }),

  startReachabilityCheck: () => {
    const existing = get().checkTimer;
    if (existing) clearInterval(existing);
    const timer = setInterval(async () => {
      if (!get().isOffline) return;
      try {
        const base = API_BASE.replace(/\/api$/, '');
        const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
        if (res.ok) {
          set({ isOffline: false, offlineSince: null });
        }
      } catch (_e) {
        /* still offline */
      }
    }, 30000);
    set({ checkTimer: timer });
  },

  stopReachabilityCheck: () => {
    const t = get().checkTimer;
    if (t) clearInterval(t);
    set({ checkTimer: null });
  },
}));
