'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useDeviceClass } from '@/lib/mobile/device';
import { desktopPathForMobile, mobileAccess } from '@/lib/mobile/routePolicy';
import { useAuthStore } from '@/store/authStore';
import MobileShell from './MobileShell';
import { PermissionDeniedScreen } from './MobileStates';

// The scan screen is a full-bleed camera flow — no tab bar, per Figma.
const NO_NAV = new Set(['/m/products/new']);

/** Wraps every /m route: device routing first, then the route's permission. */
export default function MobileRouteGate({ children }: { children: React.ReactNode }) {
  const device = useDeviceClass();
  const pathname = usePathname() || '';
  const router = useRouter();
  const permissions = useAuthStore((s) => s.permissions);

  useEffect(() => {
    if (device === 'desktop') router.replace(desktopPathForMobile(pathname));
  }, [device, pathname, router]);

  if (device !== 'phone') return null;

  const access = mobileAccess(pathname, permissions);
  if (access.kind === 'permission-denied') {
    return (
      <MobileShell>
        <PermissionDeniedScreen />
      </MobileShell>
    );
  }
  return <MobileShell nav={!NO_NAV.has(pathname)}>{children}</MobileShell>;
}
