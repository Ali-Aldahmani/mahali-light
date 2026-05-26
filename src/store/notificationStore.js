import { create } from 'zustand';
import * as api from '../services/notificationService.js';
import { useAuthStore } from './authStore.js';
import { toast } from './toastStore.js';

// ---- Sound ----------------------------------------------------------------
// Lazy-loaded HTMLAudioElement per severity, cached so we don't re-decode
// each play. Falls back silently if the asset is missing or audio blocked.
const SOUND_FILES = {
  info: '/sounds/notify-info.mp3',
  warning: '/sounds/notify-warning.mp3',
  error: '/sounds/notify-error.mp3',
  critical: '/sounds/notify-critical.mp3',
};
const audioCache = new Map();
let lastSoundAt = 0;
function playSound(severity = 'info') {
  // Coalesce bursts — only one sound per 1500ms even if several arrive.
  const now = Date.now();
  if (now - lastSoundAt < 1500) return;
  lastSoundAt = now;
  try {
    const src = SOUND_FILES[severity] || SOUND_FILES.info;
    let a = audioCache.get(src);
    if (!a) {
      a = new Audio(src);
      a.volume = 0.3;
      audioCache.set(src, a);
    }
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch (_e) {
    /* ignore */
  }
}

function maybeDesktopNotify(notification) {
  if (!notification) return;
  if (notification.severity !== 'critical') return;
  if (typeof document !== 'undefined' && document.hasFocus()) return;
  try {
    const ipc = typeof window !== 'undefined' && window.electron;
    if (ipc && typeof ipc.notifyDesktop === 'function') {
      ipc
        .notifyDesktop({
          title: notification.title,
          body: notification.message,
          severity: notification.severity,
        })
        .catch(() => {});
      return;
    }
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      window.Notification.permission === 'granted'
    ) {
      // eslint-disable-next-line no-new
      new window.Notification(notification.title, { body: notification.message });
    }
  } catch (_e) {
    /* ignore */
  }
}

export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  approvalCount: 0,
  panelOpen: false,
  preferences: null,
  loading: false,
  hasMore: false,
  page: 1,
  filter: { category: null, severity: null, unread_only: false },

  setPanelOpen: (open) => set({ panelOpen: open }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  // Called when a new notification arrives via socket.
  addNotification: (notification) => {
    set((s) => {
      // Dedupe — if the same id is already there, replace it (server may
      // have rewritten an existing row via batching).
      const idx = s.notifications.findIndex((n) => n.id === notification.id);
      let next;
      if (idx >= 0) {
        next = [...s.notifications];
        next[idx] = notification;
      } else {
        next = [notification, ...s.notifications].slice(0, 100);
      }
      return { notifications: next };
    });
    if (!notification.is_read) {
      set((s) => ({ unreadCount: s.unreadCount + 1 }));
    }
    if (get().preferences?.sound_enabled !== false) {
      playSound(notification.severity);
    }
    maybeDesktopNotify(notification);
  },

  setUnreadCount: (count) => set({ unreadCount: Math.max(0, Number(count) || 0) }),
  setApprovalCount: (count) =>
    set({ approvalCount: Math.max(0, Number(count) || 0) }),

  fetchUnreadCount: async () => {
    try {
      const res = await api.getUnreadCount();
      set({ unreadCount: res?.count || 0 });
    } catch (_e) {
      /* silent */
    }
  },

  fetchApprovalCount: async () => {
    try {
      const res = await api.getApprovalCounts();
      set({ approvalCount: res?.total || 0 });
    } catch (_e) {
      /* silent */
    }
  },

  fetchNotifications: async ({ append = false, filter = null } = {}) => {
    if (get().loading) return;
    const f = filter || get().filter;
    const nextPage = append ? get().page + 1 : 1;
    set({ loading: true });
    try {
      const res = await api.listNotifications({
        page: nextPage,
        limit: 30,
        category: f.category || undefined,
        severity: f.severity || undefined,
        unread_only: f.unread_only ? 1 : undefined,
      });
      const list = res?.data || [];
      set((s) => ({
        notifications: append
          ? [...s.notifications, ...list].slice(0, 200)
          : list,
        page: nextPage,
        hasMore: list.length === 30,
        filter: f,
        unreadCount:
          typeof res?.meta?.unread_count === 'number'
            ? res.meta.unread_count
            : s.unreadCount,
      }));
    } catch (err) {
      toast.error(`Could not load notifications: ${err.message || 'unknown error'}`);
    } finally {
      set({ loading: false });
    }
  },

  setFilter: (filter) => {
    set({ filter });
    get().fetchNotifications({ filter });
  },

  markRead: async (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, is_read: true } : n,
      ),
      unreadCount: Math.max(
        0,
        s.unreadCount - (s.notifications.find((n) => n.id === id)?.is_read ? 0 : 1),
      ),
    }));
    try {
      await api.markRead(id);
    } catch (_e) { /* silent */ }
  },

  markAllRead: async () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    }));
    try {
      await api.markAllRead();
    } catch (_e) { /* silent */ }
  },

  dismiss: async (id) => {
    const target = get().notifications.find((n) => n.id === id);
    if (target?.severity === 'critical') {
      const role = useAuthStore.getState().user?.role;
      if (role !== 'Admin') {
        toast.warning('Critical notifications can only be dismissed by Admin.');
        return;
      }
    }
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
      unreadCount: target && !target.is_read ? Math.max(0, s.unreadCount - 1) : s.unreadCount,
    }));
    try {
      await api.dismissNotification(id);
    } catch (err) {
      toast.error(err.message || 'Could not dismiss notification.');
    }
  },

  fetchPreferences: async () => {
    try {
      const prefs = await api.getPreferences();
      set({ preferences: prefs });
    } catch (_e) { /* silent */ }
  },

  updatePreferences: async (patch) => {
    try {
      const prefs = await api.updatePreferences(patch);
      set({ preferences: prefs });
      toast.success('Notification preferences saved.');
      return prefs;
    } catch (err) {
      toast.error(err.message || 'Could not save preferences.');
      throw err;
    }
  },

  reset: () =>
    set({
      notifications: [],
      unreadCount: 0,
      approvalCount: 0,
      panelOpen: false,
      preferences: null,
      loading: false,
      hasMore: false,
      page: 1,
      filter: { category: null, severity: null, unread_only: false },
    }),
}));
