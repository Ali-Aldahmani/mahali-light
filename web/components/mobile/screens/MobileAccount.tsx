'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useSocketStore } from '@/store/socketStore';
import { logout } from '@/services/authService';

export default function MobileAccount() {
  const user = useAuthStore((s) => s.user);
  const disconnect = useSocketStore((s) => s.disconnect);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await logout();
    } catch (_e) {
      // logout() already cleared the local session in its finally block.
    } finally {
      disconnect();
      router.replace('/login');
    }
  }

  const name = user?.username || '—';
  return (
    <div className="font-m-work">
      <header className="px-2">
        <h1 className="text-[26px] font-semibold leading-tight text-ink">Account</h1>
        <p className="mt-1 text-[13px] text-ink-muted">Manage your account and preferences</p>
      </header>

      <section aria-label="Profile" className="mt-5 flex min-h-[112px] items-center gap-4 rounded-[18px] bg-white px-4 py-5">
        <span
          aria-hidden
          className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-m-accent text-[30px] font-semibold text-white"
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[19px] font-semibold text-ink">{name}</p>
          {user?.role && <p className="truncate text-[13px] text-ink-muted">{user.role}</p>}
          <span className="mt-2 inline-flex h-5 items-center rounded-[10px] bg-accent-light px-3 text-[10px] font-medium text-m-accent">
            Active
          </span>
        </div>
      </section>

      <h2 className="mt-7 px-2 text-[11px] font-semibold uppercase text-ink-muted">Session</h2>
      <button
        type="button"
        onClick={onLogout}
        disabled={busy}
        className="mt-2 flex min-h-[68px] w-full items-center gap-4 rounded-[14px] bg-white px-4 text-left active:bg-m-field disabled:opacity-70"
      >
        {busy ? (
          <Loader2 aria-hidden className="h-[22px] w-[22px] animate-spin text-m-accent" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/mobile/logout.svg" alt="" aria-hidden className="h-[22px] w-[22px]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-medium text-ink">{busy ? 'Logging out…' : 'Log out'}</span>
          <span className="block text-[11px] text-ink-muted">End this session on this device</span>
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mobile/chevron-right.svg" alt="" aria-hidden className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
