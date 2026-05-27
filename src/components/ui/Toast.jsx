import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToastStore } from '../../store/toastStore.js';
import { cn } from '../../utils/cn.js';

const TONES = {
  success: {
    bar: 'bg-success',
    icon: <CheckCircle2 size={18} className="text-success" />,
    label: 'Success',
  },
  error: {
    bar: 'bg-error',
    icon: <XCircle size={18} className="text-error" />,
    label: 'Error',
  },
  warning: {
    bar: 'bg-warning',
    icon: <AlertTriangle size={18} className="text-warning" />,
    label: 'Warning',
  },
  info: {
    bar: 'bg-ink-muted',
    icon: <Info size={18} className="text-ink-muted" />,
    label: 'Info',
  },
};

export default function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => {
        const tone = TONES[t.type] || TONES.info;
        return (
          <div
            key={t.id}
            role="alert"
            className={cn(
              'pointer-events-auto card flex overflow-hidden',
              'animate-[toastin_180ms_ease-out]',
            )}
          >
            <span className={cn('w-1 shrink-0', tone.bar)} />
            <div className="flex flex-1 items-start gap-3 px-3 py-3">
              <div className="mt-0.5">{tone.icon}</div>
              <div className="flex-1 min-w-0">
                {t.title && (
                  <p className="text-sm font-semibold text-ink leading-tight">{t.title}</p>
                )}
                <p className="text-sm text-ink-muted break-words">{t.message}</p>
                {t.actionLabel && t.onAction && (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-accent hover:underline"
                    onClick={() => {
                      t.onAction?.();
                      dismiss(t.id);
                    }}
                  >
                    {t.actionLabel}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded-md p-1 text-ink-muted hover:bg-surface-2"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
      <style>{`@keyframes toastin { from { transform: translateY(-8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </div>
  );
}
