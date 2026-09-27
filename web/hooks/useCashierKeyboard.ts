import { useEffect, useRef } from 'react';
import {
  isEditableTarget,
  isShortcutChar,
  resolveShortcut,
  type CashierAction,
} from '@/lib/cashier/shortcuts';

// Keystrokes closer together than this are a scanner burst, not a person.
export const SCAN_GAP_MS = 35;

// Single keydown controller for Cashier Mode:
//  - printable keys typed while no field is focused are redirected into the
//    search/scan box (so a scanner works without clicking it first);
//  - during a scan burst, characters like "-" or "+" are treated as barcode
//    text instead of quantity shortcuts;
//  - everything else is resolved through the central shortcut map.
// Disable it while a dialog is open so the dialog owns the keyboard.
export function useCashierKeyboard({
  enabled,
  onAction,
  onType,
}: {
  enabled: boolean;
  onAction: (action: CashierAction, e: KeyboardEvent) => void;
  onType: (char: string) => void;
}) {
  const handlers = useRef({ onAction, onType });
  handlers.current = { onAction, onType };
  const lastCharAt = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return;
      const editing = isEditableTarget(e.target);
      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const burst = printable && now - lastCharAt.current < SCAN_GAP_MS;
      if (printable) lastCharAt.current = now;

      // Space stays native so it can still activate a focused button.
      if (printable && !editing && e.key !== ' ' && (burst || !isShortcutChar(e.key))) {
        e.preventDefault();
        handlers.current.onType(e.key);
        return;
      }

      const action = resolveShortcut(e, { editing });
      if (!action) return;
      e.preventDefault();
      handlers.current.onAction(action, e);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
