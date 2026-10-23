'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSocketStore } from '@/store/socketStore';
import { logout as apiLogout } from '@/services/authService';

/** Ends the session on the server, drops the socket and goes to the login page. */
export function useSignOut() {
  const router = useRouter();
  const disconnect = useSocketStore((s) => s.disconnect);
  return useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      disconnect();
      router.replace('/login');
    }
  }, [disconnect, router]);
}
