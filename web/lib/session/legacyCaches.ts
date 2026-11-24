// Older builds copied the whole product catalogue, the customer list (names,
// phones, credit balances), settings and stock levels into localStorage on
// every sign-in. Nothing ever read those copies and nothing cleared them, so
// customer data stayed on shared tills after sign-out (engineering audit
// F-FE-05). The code that wrote them is gone; this removes what is left.
const PREFIXES = ['mahali.cache.', 'mahali.stockCache.'];

export function clearLegacyBrowserCaches(storage: Storage | null = safeLocalStorage()): number {
  if (!storage) return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && PREFIXES.some((p) => key.startsWith(p))) keys.push(key);
    }
    for (const key of keys) {
      storage.removeItem(key);
      removed += 1;
    }
  } catch (_e) {
    // Storage unavailable (private mode, blocked): nothing to clear.
  }
  return removed;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_e) {
    return null;
  }
}
