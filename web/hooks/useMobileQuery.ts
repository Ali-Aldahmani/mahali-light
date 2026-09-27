'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Loading / error / retry for a read-only mobile screen. Stale responses are dropped. */
export function useMobileQuery<T>(load: () => Promise<T>, deps: unknown[], { enabled = true } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loadRef.current();
      if (id === seq.current) setData(result);
    } catch (err: any) {
      if (id === seq.current) {
        setError(
          err?.code === 'NETWORK_ERROR' || err?.code === 'NETWORK_TIMEOUT'
            ? 'Cannot reach the server. Check your connection and try again.'
            : err?.message || 'Something went wrong while loading.',
        );
      }
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { data, loading, error, reload: run };
}
