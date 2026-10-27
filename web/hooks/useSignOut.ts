'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSocketStore } from '@/store/socketStore';
import { logout as apiLogout, logoutAllDevices } from '@/services/authService';
import { toast } from '@/store/toastStore';

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

/** Closes every open session of this user (authentication audit AUTH-09). */
export function useSignOutEverywhere() {
  const router = useRouter();
  const disconnect = useSocketStore((s) => s.disconnect);
  return useCallback(async () => {
    try {
      await logoutAllDevices();
      disconnect();
      router.replace('/login');
    } catch (err: any) {
      toast.error(err?.message || 'Could not sign out your other devices. Try again.');
    }
  }, [disconnect, router]);
}
