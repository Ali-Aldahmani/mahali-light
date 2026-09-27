'use client';

import { useEffect } from 'react';
import AuthGuard from '@/components/guards/AuthGuard';
import PhoneGate from '@/components/mobile/PhoneGate';
import ErrorBoundary from '@/components/ErrorBoundary';
import GlobalErrorShell from '@/components/errors/GlobalErrorShell';
import { useAuthStore } from '@/store/authStore';
import { useSocketStore } from '@/store/socketStore';

// Dedicated full-screen shell for Cashier Mode: same session, same API and
// permissions as Admin Mode, but none of the admin navigation.
function CashierShell({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);

  useEffect(() => {
    if (!token) return undefined;
    connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <GlobalErrorShell>
      <ErrorBoundary>{children}</ErrorBoundary>
    </GlobalErrorShell>
  );
}

export default function CashierLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <PhoneGate>
        <CashierShell>{children}</CashierShell>
      </PhoneGate>
    </AuthGuard>
  );
}
