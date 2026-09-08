'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

/**
 * Client-side auth boundary. Express remains the authorization authority —
 * every sensitive API call is re-checked server-side. This guard only
 * decides what the browser renders, mirroring the old ProtectedRoute.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!token || !user) {
      router.replace(`/login?from=${encodeURIComponent(pathname || '/dashboard')}`);
    }
  }, [token, user, router, pathname]);

  if (!token || !user) return null;
  return <>{children}</>;
}
