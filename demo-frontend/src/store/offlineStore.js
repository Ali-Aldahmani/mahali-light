import { create } from 'zustand';

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
    const timer = setInterval(() => {
      if (!get().isOffline) return;
      set({ isOffline: false, offlineSince: null });
    }, 30000);
    set({ checkTimer: timer });
  },

  stopReachabilityCheck: () => {
    const t = get().checkTimer;
    if (t) clearInterval(t);
    set({ checkTimer: null });
  },
}));
