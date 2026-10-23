'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bug } from 'lucide-react';
import { UserMenu } from '@/components/ui/user-menu';
import { RoleBadge } from '@/components/ui/Badge';
import { useAuthStore } from '@/store/authStore';
import { useSocketStore } from '@/store/socketStore';
import { useUiErrorStore } from '@/store/uiErrorStore';
import { getMe, logout as apiLogout } from '@/services/authService';

/**
 * The account menu in the top-right of the header: username, the person's
 * name from their employee record, their role tag, Report a bug and Sign out.
 */
export default function HeaderUserMenu() {
  const user = useAuthStore((s) => s.user);
  const isConnected = useSocketStore((s) => s.isConnected);
  const disconnect = useSocketStore((s) => s.disconnect);
  const openBugReport = useUiErrorStore((s) => s.openBugReport);
  const router = useRouter();

  // Sessions saved before the server sent full_name don't have it yet; fetch once.
  const missingName = !!user && user.full_name === undefined;
  useEffect(() => {
    if (missingName) getMe().catch(() => {});
  }, [missingName]);

  if (!user) return null;

  const fullName = user.full_name?.trim();

  async function handleSignOut() {
    try {
      await apiLogout();
    } finally {
      disconnect();
      router.replace('/login');
    }
  }

  return (
    <UserMenu
      user={{
        name: user.username,
        detail: fullName && fullName !== user.username ? fullName : undefined,
        badge: <RoleBadge role={user.role} size="sm" />,
        triggerDetail: user.role,
        avatarSrc: user.avatar_url || undefined,
      }}
      online={isConnected}
      showName
      showTheme={false}
      items={[
        {
          label: 'Report a bug',
          icon: <Bug size={16} strokeWidth={1.75} />,
          keys: ['Ctrl', 'Shift', 'B'],
          onSelect: openBugReport,
        },
      ]}
      onSignOut={handleSignOut}
    />
  );
}
