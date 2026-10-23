import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useMemo } from 'react';
import { useAuthStore } from '@/store/authStore';
import { SHORTCUT_ACTIONS } from '@/lib/shortcuts/actions';
import type { ShortcutActionId } from '@/lib/shortcuts/actions';

/** A user's changes from the defaults: a shortcut, or null for "no shortcut". */
type Overrides = Partial<Record<ShortcutActionId, string | null>>;

interface ShortcutState {
  byUser: Record<string, Overrides>;
  setBinding: (userId: string, actionId: ShortcutActionId, shortcut: string | null) => void;
  resetUser: (userId: string) => void;
}

// Saved in this browser, per user. Kept behind this store so it can move to
// the server later without touching the engine or the settings dialog.
export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set) => ({
      byUser: {},
      setBinding: (userId, actionId, shortcut) =>
        set((s) => {
          const def = SHORTCUT_ACTIONS.find((a) => a.id === actionId);
          const mine: Overrides = { ...(s.byUser[userId] || {}) };
          if (def && def.defaultShortcut === shortcut) delete mine[actionId];
          else mine[actionId] = shortcut;
          return { byUser: { ...s.byUser, [userId]: mine } };
        }),
      resetUser: (userId) =>
        set((s) => {
          const next = { ...s.byUser };
          delete next[userId];
          return { byUser: next };
        }),
    }),
    { name: 'mahali-light.shortcuts', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

const NO_OVERRIDES: Overrides = {};

/** The signed-in user's shortcut for every action (defaults plus their changes). */
export function useShortcutBindings(): Record<ShortcutActionId, string | null> {
  const userId = useAuthStore((s) => (s.user?.id != null ? String(s.user.id) : ''));
  const overrides = useShortcutStore((s) => s.byUser[userId] || NO_OVERRIDES);
  return useMemo(() => {
    const out = {} as Record<ShortcutActionId, string | null>;
    for (const a of SHORTCUT_ACTIONS) out[a.id] = a.id in overrides ? overrides[a.id] ?? null : a.defaultShortcut;
    return out;
  }, [overrides]);
}
