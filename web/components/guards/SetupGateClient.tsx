'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSetupStore } from '@/store/setupStore';
import { useAppSettingsStore } from '@/store/appSettingsStore';
import Skeleton from '@/components/ui/skeleton';
import Button from '@/components/ui/Button';
import { AppShellSkeleton, isShellRoute } from '@/components/layout/AppSkeleton';

const DEFAULT_TITLE = 'Bytecra POS';

// Wait before asking the server again after a failed check: 2 s, 4 s, 8 s,
// then every 15 s, so a till that starts before the server keeps trying.
export function retryDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt - 1), 15000);
}

export default function SetupGateClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const completed = useSetupStore((s) => s.completed);
  const setCompleted = useSetupStore((s) => s.setCompleted);
  const storeName = useAppSettingsStore(
    (s) => s.publicSettings?.store_name || s.settings?.store_name,
  );

  // Number of failed checks so far; > 0 means the server couldn't be reached.
  // Only an actual answer from the server decides "set up or not": a network
  // blip or a server restart during page load used to send a cashier to the
  // create-admin wizard (engineering audit F-FE-01).
  const [failures, setFailures] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (completed !== null) return undefined;
    let cancelled = false;
    useAppSettingsStore
      .getState()
      .fetchPublic()
      .then((s: any) => {
        if (cancelled) return;
        if (s && typeof s === 'object') {
          setCompleted(Boolean(s.setup_completed));
          return;
        }
        throw new Error('No settings in the reply');
      })
      .catch(() => {
        if (!cancelled) setFailures((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [completed, setCompleted, retryTick]);

  // After each failed check, ask again after a growing delay.
  useEffect(() => {
    if (completed !== null || failures === 0) return undefined;
    const timer = setTimeout(() => setRetryTick((t) => t + 1), retryDelayMs(failures));
    return () => clearTimeout(timer);
  }, [completed, failures]);

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

  if (completed === null && failures > 0) {
    return (
      <div className="flex min-h-screen items-start justify-center bg-bg px-4 pt-[18vh]">
        <div
          role="alert"
          className="w-full max-w-md rounded-card border border-border bg-surface p-6 text-center"
        >
          <h1 className="text-lg font-semibold text-ink">Can't reach the server</h1>
          <p className="mt-2 text-sm text-ink-muted">
            The POS server isn't answering. It may be starting up, or this PC may have lost its
            network connection. Trying again automatically…
          </p>
          <Button className="mt-4" onClick={() => setRetryTick((t) => t + 1)}>
            Try again now
          </Button>
        </div>
      </div>
    );
  }

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
