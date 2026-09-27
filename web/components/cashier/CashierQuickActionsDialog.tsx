'use client';

import type { ComponentType } from 'react';
import Modal from '@/components/ui/Modal';
import { SHORTCUT_HELP } from '@/lib/cashier/shortcuts';

export interface QuickAction {
  id: string;
  label: string;
  description?: string;
  Icon: ComponentType<{ className?: string }>;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
}

// Secondary actions menu. The caller passes only the actions the user is
// permitted to run — the server still rejects anything unauthorized.
export default function CashierQuickActionsDialog({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: QuickAction[];
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Quick actions" size="lg">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Quick actions">
        {actions.map(({ id, label, description, Icon, hint, disabled, onSelect }, i) => (
          <li key={id}>
            <button
              type="button"
              autoFocus={i === 0}
              disabled={disabled}
              onClick={() => {
                onClose();
                onSelect();
              }}
              className="flex h-full min-h-[5.5rem] w-full flex-col items-start gap-1 rounded-card border border-border bg-surface p-3 text-left touch-manipulation hover:border-accent hover:bg-accent-light/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            >
              <span className="flex w-full items-center justify-between">
                <Icon className="h-5 w-5 text-accent" />
                {hint && <kbd className="rounded border border-border px-1.5 text-[10px] text-ink-muted">{hint}</kbd>}
              </span>
              <span className="text-sm font-semibold text-ink">{label}</span>
              {description && <span className="text-xs text-ink-muted">{description}</span>}
            </button>
          </li>
        ))}
      </ul>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer py-2 text-ink-muted">Keyboard shortcuts</summary>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 pt-1 sm:grid-cols-3">
          {SHORTCUT_HELP.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-2">
              <dt className="text-ink-muted">{s.label}</dt>
              <dd>
                <kbd className="rounded border border-border px-1.5 text-xs">{s.keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </Modal>
  );
}
