const { query } = require('../db/postgres');

// Pluggable global barcode lookup. Default provider (UPCitemdb) works out of
// the box on its free "trial" tier (no API key, shared rate limit) so a shop
// can use barcode-scan-to-autofill immediately; set BARCODE_LOOKUP_API_KEY to
// move to a paid tier for higher volume. Set BARCODE_LOOKUP_PROVIDER=none to
// disable outbound lookups entirely (internal-only matching still works).
const PROVIDER = (process.env.BARCODE_LOOKUP_PROVIDER || 'upcitemdb').toLowerCase();
const API_KEY = process.env.BARCODE_LOOKUP_API_KEY || '';
const API_URL = process.env.BARCODE_LOOKUP_API_URL || '';

// A barcode already registered anywhere in this shop's own inventory always
// wins over an external lookup — the cashier/inventory manager needs to know
// it's a duplicate, not get external metadata for it.
async function lookupInternal(barcode) {
  const { rows } = await query(
    `SELECT
       pv.id AS variant_id,
       pv.product_id,
       p.name AS product_name,
       pv.sku,
       pv.barcode,
       pv.internal_barcode,
       pv.supplier_barcode
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE pv.barcode = $1 OR pv.internal_barcode = $1 OR pv.supplier_barcode = $1
     LIMIT 1`,
    [barcode],
  );
  return rows[0] || null;
}

async function lookupUpcItemDb(barcode) {
  const base =
    API_URL ||
    (API_KEY
      ? 'https://api.upcitemdb.com/prod/v1/lookup'
      : 'https://api.upcitemdb.com/prod/trial/lookup');
  const url = `${base}?upc=${encodeURIComponent(barcode)}`;
  const headers = { Accept: 'application/json' };
  if (API_KEY) {
    headers.user_key = API_KEY;
    headers.key_type = '3scale';
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = await res.json();
  const item = Array.isArray(data?.items) ? data.items[0] : null;
  if (!item) return null;
  return {
    barcode,
    name: item.title || null,
    brand: item.brand || null,
    category: item.category || null,
    description: item.description || null,
    imageUrl: Array.isArray(item.images) && item.images.length ? item.images[0] : null,
    provider: 'upcitemdb',
  };
}

async function lookupExternal(barcode) {
  if (PROVIDER === 'none') return null;
  try {
    if (PROVIDER === 'upcitemdb') return await lookupUpcItemDb(barcode);
    return null;
  } catch (_e) {
    // Network hiccup or provider outage — degrade to "not found" rather than
    // blocking the add-product flow. The user can still fill the form by hand.
    return null;
  }
}

async function lookupBarcode(barcode) {
  const internal = await lookupInternal(barcode);
  if (internal) {
    return { barcode, source: 'internal', internal, external: null };
  }
  const external = await lookupExternal(barcode);
  return { barcode, source: external ? 'external' : 'not_found', internal: null, external };
}

module.exports = { lookupBarcode };
