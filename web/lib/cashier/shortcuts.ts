// Central keyboard map for Cashier Mode. Function keys work everywhere
// (they never type text); character shortcuts only fire when focus is not in
// a text field, so typing a customer name or a quantity is never hijacked.

export type CashierAction =
  | 'focusSearch'
  | 'pay'
  | 'customer'
  | 'hold'
  | 'resume'
  | 'quickActions'
  | 'qtyUp'
  | 'qtyDown'
  | 'removeSelected'
  | 'selectPrev'
  | 'selectNext'
  | 'escape';

export const SHORTCUT_HINTS: Record<string, string> = {
  focusSearch: 'F2',
  pay: 'F4',
  customer: 'F6',
  hold: 'F7',
  resume: 'F8',
  quickActions: 'F9',
};

export const SHORTCUT_HELP: { keys: string; label: string }[] = [
  { keys: 'F2 or /', label: 'Search / scan' },
  { keys: 'F4', label: 'Pay' },
  { keys: 'F6', label: 'Customer' },
  { keys: 'F7', label: 'Hold sale' },
  { keys: 'F8', label: 'Held sales' },
  { keys: 'F9', label: 'Quick actions' },
  { keys: '↑ ↓', label: 'Select cart line' },
  { keys: '+ / −', label: 'Change quantity' },
  { keys: 'Delete ×2', label: 'Remove selected line' },
  { keys: 'Esc', label: 'Close / clear' },
];

const FUNCTION_KEYS: Record<string, CashierAction> = {
  F2: 'focusSearch',
  F4: 'pay',
  F6: 'customer',
  F7: 'hold',
  F8: 'resume',
  F9: 'quickActions',
};

const PLAIN_KEYS: Record<string, CashierAction> = {
  '/': 'focusSearch',
  '+': 'qtyUp',
  '=': 'qtyUp',
  '-': 'qtyDown',
  Delete: 'removeSelected',
  ArrowUp: 'selectPrev',
  ArrowDown: 'selectNext',
  Escape: 'escape',
};

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return !!el.isContentEditable;
}

export function resolveShortcut(
  e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  { editing }: { editing: boolean },
): CashierAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const fn = FUNCTION_KEYS[e.key];
  if (fn) return fn;
  if (editing) return null;
  return PLAIN_KEYS[e.key] ?? null;
}

export function isShortcutChar(key: string): boolean {
  return key.length === 1 && key in PLAIN_KEYS;
}
