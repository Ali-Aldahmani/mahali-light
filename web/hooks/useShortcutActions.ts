'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useQuickActionStore } from '@/store/quickActionStore';
import { SHORTCUT_ACTIONS } from '@/lib/shortcuts/actions';
import type { ShortcutActionDef, ShortcutActionId } from '@/lib/shortcuts/actions';

export interface RunnableShortcutAction extends ShortcutActionDef {
  run: () => void;
}

/** The shortcut actions this user may run, each with what it does. */
export function useShortcutActions(): RunnableShortcutAction[] {
  const router = useRouter();
  const permissions = useAuthStore((s) => s.permissions);
  const openCustomerForm = useQuickActionStore((s) => s.openCustomerForm);

  return useMemo(() => {
    const runners: Record<ShortcutActionId, () => void> = {
      'new-pos': () => router.push('/pos'),
      'cashier-mode': () => router.push('/cashier'),
      'new-customer': () => openCustomerForm(),
      'new-product': () => router.push('/products/new'),
    };
    const allowed = (p: string | null) => !p || (permissions || []).includes(p) || (permissions || []).includes('*');
    return SHORTCUT_ACTIONS.filter((a) => allowed(a.permission)).map((a) => ({ ...a, run: runners[a.id] }));
  }, [router, permissions, openCustomerForm]);
}
