'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

/**
 * Per-route permission gate (mirrors ProtectedRoute's `permission` prop).
 * UX-only — Express re-validates every request server-side (RBAC + overrides).
 */
export default function RequirePermission({
  permission,
  children,
}: {
  permission?: string;
  children: React.ReactNode;
}) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const router = useRouter();
  const allowed = !permission || hasPermission(permission);

  useEffect(() => {
    if (!allowed) router.replace('/dashboard');
  }, [allowed, router]);

  if (!allowed) return null;
  return <>{children}</>;
}
