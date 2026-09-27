'use client';

import AuthGuard from '@/components/guards/AuthGuard';
import MobileRouteGate from '@/components/mobile/MobileRouteGate';

// Phone companion: read-mostly views + permission-gated Quick Add Product.
// Same session, API and permissions as the desktop app.
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <MobileRouteGate>{children}</MobileRouteGate>
    </AuthGuard>
  );
}
