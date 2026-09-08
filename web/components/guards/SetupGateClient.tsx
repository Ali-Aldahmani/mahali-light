'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getPublicAppSettings } from '@/services/appSettingsService';
import { useSetupStore } from '@/store/setupStore';

export default function SetupGateClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const completed = useSetupStore((s) => s.completed);
  const setCompleted = useSetupStore((s) => s.setCompleted);

  useEffect(() => {
    if (completed !== null) return;
    getPublicAppSettings()
      .then((s: any) => setCompleted(Boolean(s?.setup_completed)))
      .catch(() => setCompleted(false));
  }, [completed, setCompleted]);

  useEffect(() => {
    if (completed === null) return;
    if (!completed && pathname !== '/setup') {
      router.replace('/setup');
    } else if (completed && pathname === '/setup') {
      router.replace('/login');
    }
  }, [completed, pathname, router]);

  if (completed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-ink-muted">
        Loading…
      </div>
    );
  }

  if ((!completed && pathname !== '/setup') || (completed && pathname === '/setup')) {
    return null;
  }

  return <>{children}</>;
}
