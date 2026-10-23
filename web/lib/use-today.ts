import { useMemo, useSyncExternalStore } from 'react';

/**
 * The viewer's local date (midnight), or null during server render and the
 * first client render, so markup never disagrees about "today" across time
 * zones. Re-checks every minute, so it rolls over at midnight.
 */
const keyOf = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

function subscribe(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

export function useToday(): Date | null {
  const key = useSyncExternalStore(subscribe, () => keyOf(new Date()), () => null);
  return useMemo(() => {
    if (!key) return null;
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [key]);
}

export default useToday;
