import { create } from 'zustand';

let _id = 0;

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 20_000;

export const useToastStore = create((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = ++_id;
    const defaults = {
      info: DEFAULT_DURATION,
      success: DEFAULT_DURATION,
      warning: DEFAULT_DURATION,
      error: DEFAULT_DURATION,
    };
    const next = {
      id,
      type: 'info',
      duration: defaults[toast.type] ?? DEFAULT_DURATION,
      ...toast,
    };
    const list = [...get().toasts, next].slice(-MAX_VISIBLE);
    set({ toasts: list });
    if (next.duration > 0) {
      setTimeout(() => get().dismiss(id), next.duration);
    }
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (message, opts = {}) =>
    useToastStore.getState().push({ type: 'success', message, ...opts }),
  error: (message, opts = {}) =>
    useToastStore.getState().push({ type: 'error', message, ...opts }),
  warning: (message, opts = {}) =>
    useToastStore.getState().push({ type: 'warning', message, ...opts }),
  info: (message, opts = {}) =>
    useToastStore.getState().push({ type: 'info', message, ...opts }),
};
