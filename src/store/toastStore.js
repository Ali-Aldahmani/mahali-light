import { create } from 'zustand';

let _id = 0;

export const useToastStore = create((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = ++_id;
    const next = { id, type: 'info', duration: 4000, ...toast };
    set({ toasts: [...get().toasts, next] });
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
    useToastStore.getState().push({ type: 'error', message, duration: 6000, ...opts }),
  warning: (message, opts = {}) =>
    useToastStore.getState().push({ type: 'warning', message, ...opts }),
  info: (message, opts = {}) =>
    useToastStore.getState().push({ type: 'info', message, ...opts }),
};
