// Barcode helpers for Cashier Mode. A scan must match a code exactly — never
// fall back to "first search result", which would silently add the wrong
// product when a code is unknown.

const CODE_FIELDS = ['barcode', 'internalBarcode', 'supplierBarcode', 'sku'] as const;

export function normalizeCode(code: unknown): string {
  return String(code ?? '').trim();
}

export function findExactCodeMatch<T extends Record<string, any>>(
  variants: T[] | null | undefined,
  code: string,
): T | null {
  const needle = normalizeCode(code).toLowerCase();
  if (!needle) return null;
  for (const v of variants || []) {
    for (const f of CODE_FIELDS) {
      const value = v?.[f];
      if (value != null && String(value).trim().toLowerCase() === needle) return v;
    }
  }
  return null;
}

// Runs scans strictly one after another so rapid consecutive scans are added
// in order and a repeated code increments the same line instead of racing.
export function createScanQueue<R>(worker: (code: string) => Promise<R>) {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue(code: string): Promise<R> {
    const run = tail.then(() => worker(code));
    tail = run.catch(() => undefined);
    return run;
  };
}
