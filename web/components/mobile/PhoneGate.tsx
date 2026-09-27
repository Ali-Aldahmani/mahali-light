'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useDeviceClass } from '@/lib/mobile/device';
import { phoneDecisionForDesktopPath } from '@/lib/mobile/routePolicy';
import MobileShell from './MobileShell';
import { DesktopRequiredScreen } from './MobileStates';

/**
 * Sits in front of the desktop shells. Desktop/tablet: renders children
 * untouched. Phone: forwards to the mobile counterpart or explains that the
 * feature needs a desktop — typing a desktop URL never shows desktop UI.
 */
export default function PhoneGate({ children }: { children: React.ReactNode }) {
  const device = useDeviceClass();
  const pathname = usePathname() || '/';
  const router = useRouter();
  const decision = device === 'phone' ? phoneDecisionForDesktopPath(pathname) : null;
  const redirectTo = decision?.kind === 'redirect' ? decision.to : null;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  if (device === 'unknown') return null;
  if (device === 'desktop') return <>{children}</>;
  if (redirectTo) return null;
  return (
    <MobileShell>
      <DesktopRequiredScreen />
    </MobileShell>
  );
}
