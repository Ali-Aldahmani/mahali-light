'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { logout, refresh } from '@/services/authService';
import { lastInputTime, onInput, startActivityTracking } from '@/lib/auth/activity';

// Keeps a signed-in session going, and ends it the way the server will
// (authentication audit AUTH-02, AUTH-03):
// - swaps the 30-minute token for a new one two minutes before it runs out,
//   until the session's maximum length (12 hours) is reached;
// - one minute before the idle limit, says so; any input keeps the session;
// - at the idle limit, signs this screen out, so a shared till isn't left
//   open for the next person.

const REFRESH_BEFORE_MS = 2 * 60 * 1000;
const RETRY_REFRESH_MS = 30 * 1000;
const WARN_BEFORE_MS = 60 * 1000;
const CHECK_EVERY_MS = 5 * 1000;

export function tokenExpiresAt(token: string | null): number | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch (_e) {
    return null;
  }
}

function useTokenRefresh(token: string | null) {
  useEffect(() => {
    const exp = tokenExpiresAt(token);
    if (!exp) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      try {
        // Sets a new token, which re-runs this effect for the next one.
        await refresh();
      } catch (err: any) {
        // A 401 means the session is over; the API client already signed
        // this screen out. Otherwise (offline) try again while time is left.
        if (err?.status !== 401 && !cancelled && Date.now() < exp) {
          timer = setTimeout(run, RETRY_REFRESH_MS);
        }
      }
    };
    timer = setTimeout(run, Math.max(5000, exp - Date.now() - REFRESH_BEFORE_MS));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token]);
}

function useIdleSignOut(idleMinutes: number, sessionKey: string | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    startActivityTracking();
    if (!sessionKey || !(idleMinutes > 0)) return undefined;
    const limitMs = idleMinutes * 60 * 1000;
    let signingOut = false;
    const check = () => {
      const idleFor = Date.now() - lastInputTime();
      if (idleFor >= limitMs) {
        if (!signingOut) {
          signingOut = true;
          logout({ message: `Signed out after ${idleMinutes} minutes without activity.` });
        }
        return;
      }
      const left = limitMs - idleFor;
      setSecondsLeft(left <= WARN_BEFORE_MS ? Math.ceil(left / 1000) : null);
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    const stop = onInput(() => setSecondsLeft(null));
    check();
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [idleMinutes, sessionKey]);

  return secondsLeft;
}

export default function SessionKeeper() {
  const token = useAuthStore((s) => s.token);
  const sessionKey = useAuthStore((s) => s.sessionKey);
  const idleMinutes = useAuthStore((s) => s.idleSignOutMinutes);
  useTokenRefresh(token);
  const secondsLeft = useIdleSignOut(idleMinutes, sessionKey);

  if (secondsLeft == null) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(92vw,28rem)] rounded-card border border-warning bg-warning-light px-4 py-3 text-sm text-ink shadow-lg"
    >
      <p className="font-medium">You&apos;ll be signed out in {secondsLeft} seconds.</p>
      <p className="text-ink-muted">Move the mouse, tap or press a key to stay signed in.</p>
    </div>
  );
}
