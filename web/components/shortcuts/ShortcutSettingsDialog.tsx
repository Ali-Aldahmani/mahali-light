'use client';

import { useMemo } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { ShortcutList, ShortcutRecorder } from '@/components/ui/shortcut-recorder';
import type { ShortcutBinding } from '@/components/ui/shortcut-recorder';
import { useAuthStore } from '@/store/authStore';
import { useQuickActionStore } from '@/store/quickActionStore';
import { useShortcutBindings, useShortcutStore } from '@/store/shortcutStore';
import { useShortcutActions } from '@/hooks/useShortcutActions';
import { BUILT_IN_SHORTCUTS } from '@/lib/shortcuts/actions';
import type { ShortcutActionId } from '@/lib/shortcuts/actions';

/** Lets each user record their own keys for the shortcut engine's actions. */
export default function ShortcutSettingsDialog() {
  const open = useQuickActionStore((s) => s.shortcutsOpen);
  const close = useQuickActionStore((s) => s.closeShortcuts);
  const userId = useAuthStore((s) => (s.user?.id != null ? String(s.user.id) : ''));
  const setBinding = useShortcutStore((s) => s.setBinding);
  const resetUser = useShortcutStore((s) => s.resetUser);
  const actions = useShortcutActions();
  const bindings = useShortcutBindings();

  const changed = actions.some((a) => bindings[a.id] !== a.defaultShortcut);

  // Everything already taken, so recording a used combination asks first.
  const takenBy = useMemo(() => {
    const engine = actions
      .filter((a) => bindings[a.id])
      .map((a) => ({ id: a.id, shortcut: bindings[a.id] as string, label: a.label }));
    return { engine, builtIn: BUILT_IN_SHORTCUTS };
  }, [actions, bindings]);

  function othersFor(id: ShortcutActionId): ShortcutBinding[] {
    return [
      ...takenBy.engine.filter((b) => b.id !== id).map(({ shortcut, label }) => ({ shortcut, label })),
      ...takenBy.builtIn,
    ];
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Keyboard shortcuts"
      subtitle="Click a shortcut, then press the keys you want. Saved for you on this computer."
      size="md"
      footer={
        <>
          {changed && (
            <Button variant="ghost" className="mr-auto" onClick={() => resetUser(userId)}>
              Reset all to defaults
            </Button>
          )}
          <Button onClick={close}>Done</Button>
        </>
      }
    >
      <div className="space-y-5">
        {actions.length === 0 ? (
          <p className="text-sm text-ink-muted">None of the shortcut actions are available for your role.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {actions.map((a) => (
              <ShortcutRecorder
                key={a.id}
                label={a.label}
                description={a.description}
                value={bindings[a.id]}
                resetValue={a.defaultShortcut}
                bindings={othersFor(a.id)}
                placeholder="No shortcut"
                onValueChange={(next, { replaced }) => {
                  setBinding(userId, a.id, next);
                  // "Use anyway" on another action's keys moves them here.
                  const from = replaced && takenBy.engine.find((b) => b.label === replaced.label);
                  if (from) setBinding(userId, from.id, null);
                }}
              />
            ))}
          </div>
        )}

        <div className="border-t border-border pt-3">
          <ShortcutList
            label="Built-in shortcuts"
            searchable={false}
            groups={[{ label: 'Built-in (always on)', items: BUILT_IN_SHORTCUTS }]}
          />
        </div>
      </div>
    </Modal>
  );
}
