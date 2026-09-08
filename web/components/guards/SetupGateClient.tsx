'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getPublicAppSettings } from '@/services/appSettingsService';

export default function SetupGateClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [complete, setComplete] = useState(true);

  useEffect(() => {
    getPublicAppSettings()
      .then((s: any) => setComplete(Boolean(s?.setup_completed)))
      .catch(() => setComplete(false))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!complete && pathname !== '/setup') {
      router.replace('/setup');
    } else if (complete && pathname === '/setup') {
      router.replace('/login');
    }
  }, [ready, complete, pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-ink-muted">
        Loading…
      </div>
    );
  }

  if ((!complete && pathname !== '/setup') || (complete && pathname === '/setup')) {
    return null;
  }

  return <>{children}</>;
}
