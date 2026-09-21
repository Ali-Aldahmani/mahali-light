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
  permissions,
  children,
}: {
  permission?: string;
  /** Any-of a list of permissions — passes if the user holds at least one. */
  permissions?: string[];
  children: React.ReactNode;
}) {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const router = useRouter();
  const required = permissions || (permission ? [permission] : []);
  const allowed = required.length === 0 || required.some((p) => hasPermission(p));

  useEffect(() => {
    if (!allowed) router.replace('/dashboard');
  }, [allowed, router]);

  if (!allowed) return null;
  return <>{children}</>;
}
