import { createToastStore } from '@/components/ui/toast-stack';

/** Every toast closes after this long (the shop's rule). */
const DURATION = 5_000;

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  type?: ToastType;
  message?: string;
  title?: string;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * The app's one toast queue. `toast.success('Saved')` works from anywhere,
 * in components, services or stores, and shows in the stack mounted by
 * components/ui/Toast (top-right).
 */
export const appToasts = createToastStore(DURATION, 12);

function push(type: ToastType, message: string, opts: ToastInput = {}) {
  const { title, actionLabel, onAction } = opts;
  return appToasts.toast({
    type: opts.type ?? type,
    // A titled toast shows the message under the title; otherwise the message is the title.
    title: title || message,
    description: title ? message : undefined,
    duration: DURATION,
    action: actionLabel && onAction ? { label: actionLabel, onClick: () => onAction() } : undefined,
  });
}

export const toast = {
  success: (message: string, opts: ToastInput = {}) => push('success', message, opts),
  error: (message: string, opts: ToastInput = {}) => push('error', message, opts),
  warning: (message: string, opts: ToastInput = {}) => push('warning', message, opts),
  info: (message: string, opts: ToastInput = {}) => push('info', message, opts),
  dismiss: (id?: string) => appToasts.dismiss(id),
};
