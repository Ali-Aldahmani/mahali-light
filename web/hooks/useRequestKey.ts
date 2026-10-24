import { useCallback, useEffect, useRef } from 'react';
import { newRequestKey } from '@/lib/requestKey';

// One request key per opening of a form. Every submit attempt while the form
// stays open reuses it, so a retry after a timeout can't record the same
// payment or stock move twice. Opening the form again, or calling `renew`
// after a success, starts a new key for the next, separate command.
export function useRequestKey(open = true) {
  const key = useRef(newRequestKey());
  useEffect(() => {
    if (open) key.current = newRequestKey();
  }, [open]);
  const renew = useCallback(() => {
    key.current = newRequestKey();
  }, []);
  return { current: () => key.current, renew };
}
