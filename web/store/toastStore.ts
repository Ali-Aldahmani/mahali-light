import { create } from 'zustand';

let _id = 0;

const MAX_VISIBLE = 3;
const DEFAULT_DURATION = 20_000;

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  type?: ToastType;
  message?: string;
  title?: string;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

export interface Toast {
  id: number;
  type: ToastType;
  duration: number;
  message?: string;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = ++_id;
    const defaults = {
      info: DEFAULT_DURATION,
      success: DEFAULT_DURATION,
      warning: DEFAULT_DURATION,
      error: DEFAULT_DURATION,
    };
    const next: Toast = {
      id,
      type: 'info',
      duration: defaults[toast.type ?? 'info'] ?? DEFAULT_DURATION,
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
  success: (message: string, opts: ToastInput = {}) =>
    useToastStore.getState().push({ type: 'success', message, ...opts }),
  error: (message: string, opts: ToastInput = {}) =>
    useToastStore.getState().push({ type: 'error', message, ...opts }),
  warning: (message: string, opts: ToastInput = {}) =>
    useToastStore.getState().push({ type: 'warning', message, ...opts }),
  info: (message: string, opts: ToastInput = {}) =>
    useToastStore.getState().push({ type: 'info', message, ...opts }),
};
