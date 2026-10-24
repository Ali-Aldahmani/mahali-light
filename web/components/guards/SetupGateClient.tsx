'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSetupStore } from '@/store/setupStore';
import { useAppSettingsStore } from '@/store/appSettingsStore';
import Skeleton from '@/components/ui/skeleton';
import { AppShellSkeleton, isShellRoute } from '@/components/layout/AppSkeleton';

const DEFAULT_TITLE = 'Bytecra POS';

export default function SetupGateClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const completed = useSetupStore((s) => s.completed);
  const setCompleted = useSetupStore((s) => s.setCompleted);
  const storeName = useAppSettingsStore(
    (s) => s.publicSettings?.store_name || s.settings?.store_name,
  );

  useEffect(() => {
    if (completed !== null) return;
    useAppSettingsStore
      .getState()
      .fetchPublic()
      .then((s: any) => setCompleted(Boolean(s?.setup_completed)))
      .catch(() => setCompleted(false));
  }, [completed, setCompleted]);

  // Browser tab title mirrors the store name from Settings once it's
  // known, instead of always showing the hardcoded product name. Next's
  // App Router re-applies the static root `metadata.title` on every
  // client-side navigation, which races this effect and wins if it isn't
  // also re-run per route change — hence `pathname` in the deps below.
  useEffect(() => {
    document.title = storeName ? `${storeName} · POS` : DEFAULT_TITLE;
  }, [storeName, pathname]);

  useEffect(() => {
    if (completed === null) return;
    if (!completed && pathname !== '/setup') {
      router.replace('/setup');
    } else if (completed && pathname === '/setup') {
      router.replace('/login');
    }
  }, [completed, pathname, router]);

  if (completed === null) {
    // Inside the app, sketch the real frame so the page lands where the
    // placeholders were; sign-in and setup keep their centred card.
    if (isShellRoute(pathname)) return <AppShellSkeleton pathname={pathname} />;
    return (
      <div className="flex min-h-screen items-start justify-center bg-bg px-4 pt-[18vh]">
        <div className="w-full max-w-xl rounded-card border border-border bg-surface p-6">
          <Skeleton lines={6} avatar label="Loading" />
        </div>
      </div>
    );
  }

  if ((!completed && pathname !== '/setup') || (completed && pathname === '/setup')) {
    return null;
  }

  return <>{children}</>;
}
