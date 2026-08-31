import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const WIDTHS = {
  sm: 'w-[420px]',
  md: 'w-[520px]',
  lg: 'w-[640px]',
};

export default function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  width = 'md',
  children,
  footer = null,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className={cn(
          'absolute right-0 top-0 h-full bg-surface border-l border-border shadow-pop flex flex-col',
          'animate-[slidein_180ms_ease-out]',
          WIDTHS[width],
        )}
        style={{ maxWidth: '100vw' }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink leading-tight">{title}</h2>
            {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="border-t border-border bg-surface px-6 py-3 flex items-center justify-end gap-2">
            {footer}
          </footer>
        )}
      </aside>
      <style>{`@keyframes slidein { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
    </div>,
    document.body,
  );
}
