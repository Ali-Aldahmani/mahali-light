'use client';

import type { ReactNode } from 'react';
import ExpandingButtonGroup, { type ExpandingButtonGroupSize } from './expanding-button-group';
import { cn } from '@/lib/utils/cn';

/**
 * One action in a table row.
 * Put permission / state checks in `hidden` instead of wrapping in `&&`,
 * so every table reads the same way.
 */
export interface RowAction {
  id: string;
  /** Short verb, e.g. "Edit". Shown when the button expands; always its accessible name. */
  label: string;
  /** A lucide icon element, e.g. <Pencil />. Sized by the group, so don't pass a size. */
  icon: ReactNode;
  /** Return false (or reject) to skip the confirmation. A promise shows the button as busy. */
  onClick: () => void | boolean | Promise<void | boolean>;
  /** Leave the action out entirely (no permission, wrong status...). */
  hidden?: boolean;
  /** Shown dimmed: still focusable so people can see what it would do. */
  disabled?: boolean;
  /** "danger" for destructive actions (Delete, Deactivate, Void). */
  tone?: 'neutral' | 'danger';
  /** Past-tense word shown in place after an action that finishes right here, e.g. "Approved". */
  doneLabel?: string;
}

export interface RowActionsProps {
  actions: readonly RowAction[];
  /** Id of the action whose label shows at rest. Defaults to the first visible action. */
  primary?: string;
  /** Accessible name of the toolbar, e.g. "Supplier actions". */
  label?: string;
  size?: ExpandingButtonGroupSize;
  className?: string;
}

// Geometry mirrors ExpandingButtonGroup's metrics. Reserving the widest
// state up front keeps table columns from shifting when a longer label
// (or a confirmation such as "Deactivated") expands.
const GEOMETRY = {
  sm: { button: 28, labelExtra: 9, charPx: 6.9 },
  md: { button: 36, labelExtra: 11, charPx: 7.5 },
} as const;

function reservedWidth(actions: readonly RowAction[], size: ExpandingButtonGroupSize) {
  const g = GEOMETRY[size];
  const longest = Math.max(...actions.map((a) => Math.max(a.label.length, a.doneLabel?.length ?? 0)));
  const track = 4 + actions.length * g.button + (actions.length - 1) * 2;
  return Math.ceil(track + g.labelExtra + longest * g.charPx);
}

/**
 * The standard actions cell for every table: an expanding pill of icon
 * buttons, right-aligned. Table rows themselves are not clickable; opening
 * a record is always an action here (see viewColumn for the simple case).
 */
export default function RowActions({
  actions,
  primary,
  label = 'Row actions',
  size = 'sm',
  className,
}: RowActionsProps) {
  const visible = actions.filter((a) => !a.hidden);
  if (!visible.length) return null;

  return (
    <div
      className={cn('flex justify-end', className)}
      style={{ minWidth: reservedWidth(visible, size) }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <ExpandingButtonGroup
        label={label}
        size={size}
        defaultExpanded={primary ?? null}
        items={visible.map((a) => ({
          id: a.id,
          label: a.label,
          icon: a.icon,
          onSelect: a.onClick,
          disabled: a.disabled,
          tone: a.tone,
          doneLabel: a.doneLabel,
        }))}
      />
    </div>
  );
}
