/**
 * Local POS cache — products, customers, settings for fast search.
 * Uses localStorage today; Electron can swap in SQLite via IPC later.
 */
import { apiGetWithMeta } from './http.js';
import { initStockCache } from './stockCacheService.js';

const KEYS = {
  products: 'mahali.cache.products.v1',
  customers: 'mahali.cache.customers.v1',
  settings: 'mahali.cache.settings.v1',
  meta: 'mahali.cache.meta.v1',
};

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

function write(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (_e) {
    /* quota */
  }
}

function meta() {
  return read(KEYS.meta) || {};
}

function setMeta(patch) {
  write(KEYS.meta, { ...meta(), ...patch, updatedAt: new Date().toISOString() });
}

export async function syncAllCaches() {
  await initStockCache({ force: true });

  let page = 1;
  const products = [];
  const limit = 200;
  let total = Infinity;
  while ((page - 1) * limit < total) {
    const res = await apiGetWithMeta(`/products?page=${page}&limit=${limit}&status=active`);
    const batch = (res.data || []).flatMap((p) =>
      (p.variants || []).map((v) => ({
        productId: p.id,
        variantId: v.id,
        name: p.name,
        sku: v.sku,
        barcode: v.barcode,
        sellingPrice: v.sellingPrice,
      })),
    );
    products.push(...batch);
    total = res.meta?.pagination?.total ?? res.meta?.total ?? products.length;
    if (!(res.data || []).length) break;
    page++;
  }
  write(KEYS.products, products);
  setMeta({ productsSyncedAt: Date.now() });

  page = 1;
  const customers = [];
  total = Infinity;
  while ((page - 1) * limit < total) {
    const res = await apiGetWithMeta(`/customers?page=${page}&limit=${limit}`);
    for (const c of res.data || []) {
      customers.push({
        id: c.id,
        name: c.name,
        phone: c.phone,
        creditBalance: c.creditBalance,
      });
    }
    total = res.meta?.pagination?.total ?? res.meta?.total ?? customers.length;
    if (!(res.data || []).length) break;
    page++;
  }
  write(KEYS.customers, customers);
  setMeta({ customersSyncedAt: Date.now() });

  try {
    const { getPublicAppSettings } = await import('./appSettingsService.js');
    const s = await getPublicAppSettings();
    write(KEYS.settings, s);
  } catch (_e) {
    /* ignore */
  }

  return { products: products.length, customers: customers.length };
}

export function searchProductsLocal(term) {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const list = read(KEYS.products) || [];
  return list
    .filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        p.barcode?.toLowerCase().includes(q),
    )
    .slice(0, 20);
}

export function searchCustomersLocal(term) {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const list = read(KEYS.customers) || [];
  return list
    .filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        String(c.phone || '').includes(q),
    )
    .slice(0, 20);
}
