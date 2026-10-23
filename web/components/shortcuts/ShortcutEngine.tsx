'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import CustomerFormSlideOver from '@/components/customers/CustomerFormSlideOver';
import { matchesShortcut, usePlatform } from '@/components/ui/shortcut-recorder';
import { useQuickActionStore } from '@/store/quickActionStore';
import { useShortcutBindings } from '@/store/shortcutStore';
import { useShortcutActions } from '@/hooks/useShortcutActions';
import ShortcutSettingsDialog from './ShortcutSettingsDialog';
import SettingsDialog from '@/components/settings/SettingsDialog';

/**
 * Runs the user's shortcuts anywhere in the dashboard, and hosts the
 * app-wide panels they open (new customer form, shortcut settings).
 * Mount once, in the dashboard layout.
 */
export default function ShortcutEngine() {
  const router = useRouter();
  const actions = useShortcutActions();
  const bindings = useShortcutBindings();
  const platform = usePlatform();
  const settingsOpen = useQuickActionStore((s) => s.shortcutsOpen || s.settingsOpen);
  const customerFormOpen = useQuickActionStore((s) => s.customerFormOpen);
  const closeCustomerForm = useQuickActionStore((s) => s.closeCustomerForm);

  const latest = useRef({ actions, bindings, platform, paused: settingsOpen });
  latest.current = { actions, bindings, platform, paused: settingsOpen };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { actions: list, bindings: keys, platform: os, paused } = latest.current;
      // Paused while shortcuts are being edited; a focused recorder owns every key press.
      if (paused || event.repeat || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-shortcut-recorder]')) return;
      const action = list.find((a) => {
        const shortcut = keys[a.id];
        return !!shortcut && matchesShortcut(event, shortcut, os);
      });
      if (!action) return;
      // Captured at the window, so the user's binding wins over built-in handlers.
      event.preventDefault();
      event.stopImmediatePropagation();
      action.run();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <>
      <CustomerFormSlideOver
        open={customerFormOpen}
        onClose={closeCustomerForm}
        customer={null}
        onSaved={(saved: any) => {
          if (saved?.id) router.push(`/customers/${saved.id}`);
        }}
      />
      <ShortcutSettingsDialog />
      <SettingsDialog />
    </>
  );
}
