import { useEffect, useState } from 'react';

// The server's clock, as far as this screen knows it. The live connection
// sends the server time on every connect; "5m ago" is measured against it, so
// a PC whose clock is wrong still shows the right age.

let offsetMs = 0;

export function setServerTime(iso: string | undefined | null) {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(t)) offsetMs = t - Date.now();
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

// Re-render every `everyMs` so relative times ("2m ago") keep moving.
export function useServerNow(everyMs = 30000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
