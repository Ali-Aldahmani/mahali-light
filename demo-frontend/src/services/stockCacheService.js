// Local stock cache used by the POS for instant stock checks without hitting
// the server. The interface below matches what POS (Phase 6) needs; the
// underlying storage is an in-memory Map persisted to localStorage. When/if
// the Electron main process exposes a SQLite store we can swap the
// implementation behind this module without touching any consumer.

import { apiGetWithMeta } from './http.js';

const STORAGE_KEY = 'mahali.stockCache.v1';
const cache = new Map(); // variantId -> { stockQty, quarantineQty, updatedAt }
let initialized = false;
let writeTimer = null;

function loadFromDisk() {
  try {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) cache.set(k, v);
    }
  } catch (_e) {
    // ignore corrupt cache
  }
}

function scheduleFlush() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      if (typeof window === 'undefined') return;
      const obj = Object.fromEntries(cache.entries());
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (_e) {
      // quota errors are best-effort
    }
  }, 250);
}

async function fullSync() {
  // Paginate through the summary endpoint until everything is fetched.
  cache.clear();
  let page = 1;
  const limit = 200;
  let total = Infinity;
  while ((page - 1) * limit < total) {
    let res;
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        status: 'all',
        includeTotals: '0',
      });
      res = await apiGetWithMeta(`/stock/summary?${params.toString()}`);
    } catch (_err) {
      // Permission denied (no stock.view) → nothing to cache.
      return;
    }
    const items = res.data || [];
    total = res.meta?.total ?? items.length;
    for (const r of items) {
      cache.set(r.variantId, {
        stockQty: Number(r.stockQty),
        quarantineQty: Number(r.quarantineQty || 0),
        unitLabel: r.unitLabel,
        updatedAt: Date.now(),
      });
    }
    if (!items.length) break;
    page++;
  }
  scheduleFlush();
}

export async function initStockCache({ force = false } = {}) {
  if (initialized && !force) return;
  initialized = true;
  loadFromDisk();
  await fullSync();
}

export async function syncOnReconnect() {
  await fullSync();
}

export function handleStockUpdate(event) {
  if (!event) return;
  // Single variant event.
  if (event.variantId && event.newQty !== undefined) {
    cache.set(event.variantId, {
      stockQty: Number(event.newQty),
      quarantineQty:
        event.quarantineQty !== undefined
          ? Number(event.quarantineQty)
          : cache.get(event.variantId)?.quarantineQty || 0,
      unitLabel:
        cache.get(event.variantId)?.unitLabel || event.unitLabel || null,
      updatedAt: Date.now(),
    });
    scheduleFlush();
    return;
  }
  // Bulk event (e.g. stock count approval): re-sync just those variants.
  if (Array.isArray(event.affectedVariants) && event.affectedVariants.length) {
    // For simplicity, schedule a full sync. POS in Phase 6 may swap this for
    // a targeted batch fetch.
    fullSync().catch(() => {});
  }
}

export function getCachedStock(variantId) {
  return cache.get(variantId) || null;
}

export function clearStockCache() {
  cache.clear();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (_e) {
      // ignore
    }
  }
}

export function stockCacheSize() {
  return cache.size;
}
