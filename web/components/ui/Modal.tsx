import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  size?: keyof typeof SIZES;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

// Lightweight centered modal — companion to SlideOver for less form-heavy
// surfaces where a sheet would feel too "loud" (e.g. a calendar-cell drill-in).
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  children,
  footer = null,
  className = '',
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])') || [])];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const nodes = focusable(); if (!nodes.length) { e.preventDefault(); dialogRef.current?.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => (focusable()[0] || dialogRef.current)?.focus({ preventScroll: true }));
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = bodyOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-card border border-border bg-surface shadow-pop',
          SIZES[size] || SIZES.md,
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-ink leading-tight">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-border px-5 py-3 flex items-center justify-end gap-2">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
