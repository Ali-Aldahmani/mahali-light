import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import Button from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onClose?: () => void;
  onConfirm?: (extra?: any) => void | Promise<void>;
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
  /** Ask for a written reason; onConfirm then receives the trimmed text. */
  reasonLabel?: string;
  reasonMinLength?: number;
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  loading = false,
  reasonLabel,
  reasonMinLength = 5,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const reasonMissing = !!reasonLabel && reason.trim().length < reasonMinLength;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative card w-full max-w-md p-6">
        <div className="flex items-start gap-4">
          <div
            className={
              variant === 'danger'
                ? 'inline-flex h-10 w-10 items-center justify-center rounded-full bg-error-light text-error'
                : 'inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent-light text-accent'
            }
          >
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            {description && (
              <p className="mt-1 text-sm text-ink-muted">{description}</p>
            )}
          </div>
        </div>
        {reasonLabel && (
          <label htmlFor="confirm-dialog-reason" className="mt-4 block text-sm">
            <span className="text-ink">{reasonLabel}</span>
            <textarea
              id="confirm-dialog-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded-input border border-border px-3 py-2 text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <span className="text-xs text-ink-muted">At least {reasonMinLength} characters.</span>
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={reasonLabel ? () => onConfirm?.(reason.trim()) : onConfirm}
            loading={loading}
            disabled={reasonMissing}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
