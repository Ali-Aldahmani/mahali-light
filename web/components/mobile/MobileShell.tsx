'use client';

import ErrorBoundary from '@/components/ErrorBoundary';
import GlobalErrorShell from '@/components/errors/GlobalErrorShell';
import { cn } from '@/lib/utils/cn';
import { mobileFontVars } from './fonts';
import MobileBottomNav from './MobileBottomNav';

// Nav (80) + its offset (20) + the centre button's overhang (32) + breathing room.
const NAV_CLEARANCE = 'calc(env(safe-area-inset-bottom, 0px) + 148px)';

export default function MobileShell({
  children,
  nav = true,
}: {
  children: React.ReactNode;
  nav?: boolean;
}) {
  return (
    <div
      data-testid="mobile-shell"
      className={cn(mobileFontVars, 'min-h-[100dvh] overflow-x-hidden bg-m-bg font-m-work text-ink')}
    >
      <GlobalErrorShell>
        <main
          className="mx-auto w-full max-w-[440px] px-3"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
            paddingBottom: nav ? NAV_CLEARANCE : 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
            paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
            paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
          }}
        >
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </GlobalErrorShell>
      {nav && <MobileBottomNav />}
    </div>
  );
}
