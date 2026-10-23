/**
 * The actions the shortcut engine can run, and their default keys.
 * Shortcuts are strings like "mod+i" or "alt+shift+c"; `mod` is Ctrl on
 * Windows and ⌘ on a Mac (see components/ui/shortcut-recorder).
 *
 * To add an action: add it here, then give it a runner in useShortcutActions.
 */
export type ShortcutActionId = 'new-pos' | 'cashier-mode' | 'new-customer' | 'new-product';

export interface ShortcutActionDef {
  id: ShortcutActionId;
  label: string;
  description: string;
  defaultShortcut: string | null;
  /** The user needs this permission for the action to show and run. */
  permission: string | null;
}

export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  { id: 'new-pos', label: 'New POS', description: 'Open the POS to start a sale', defaultShortcut: 'mod+i', permission: 'invoice.create' },
  { id: 'cashier-mode', label: 'Cashier mode', description: 'Open the full-screen cashier workspace', defaultShortcut: 'alt+m', permission: 'invoice.create' },
  { id: 'new-customer', label: 'New customer', description: 'Open the new customer form', defaultShortcut: 'alt+c', permission: 'customer.create' },
  { id: 'new-product', label: 'New product', description: 'Open the new product page', defaultShortcut: 'alt+p', permission: 'product.create' },
];

/**
 * Shortcuts the app already uses outside the engine. They can't be rebound
 * here; recording one asks first, and the user's choice then wins.
 */
export const BUILT_IN_SHORTCUTS: Array<{ shortcut: string; label: string }> = [
  { shortcut: 'mod+k', label: 'Command palette' },
  { shortcut: 'mod+f', label: 'Command palette (search)' },
  { shortcut: 'mod+p', label: 'Open POS' },
  { shortcut: 'mod+shift+b', label: 'Report a bug' },
  { shortcut: 'f11', label: 'Toggle fullscreen' },
];
