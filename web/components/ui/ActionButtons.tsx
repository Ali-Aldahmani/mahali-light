'use client';

import { cloneElement, isValidElement, useState, type ReactElement } from 'react';
import Button from './Button';
import type { RowAction } from './RowActions';

/**
 * The same actions as RowActions, laid out as regular buttons - for page
 * headers, where there's room to show every label. Hidden actions are left
 * out; an action returning a promise shows a spinner until it settles.
 */
export default function ActionButtons({ actions }: { actions: readonly RowAction[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(a: RowAction) {
    const result = a.onClick();
    if (!(result instanceof Promise)) return;
    setBusy(a.id);
    try {
      await result;
    } finally {
      setBusy((current) => (current === a.id ? null : current));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions
        .filter((a) => !a.hidden)
        .map((a) => (
          <Button
            key={a.id}
            variant="secondary"
            disabled={a.disabled}
            loading={busy === a.id}
            leftIcon={
              isValidElement(a.icon)
                ? cloneElement(a.icon as ReactElement<{ className?: string }>, { className: 'h-4 w-4' })
                : a.icon
            }
            onClick={() => run(a)}
          >
            {a.label}
          </Button>
        ))}
    </div>
  );
}
