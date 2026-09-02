// Looks up a scanned barcode against external UPC/EAN databases so New
// Product can offer to pre-fill name/brand/image. Best-effort only — plenty
// of UAE stock (loose wire, local-brand electrical parts) genuinely won't be
// registered in ANY public database, so callers must treat a miss as
// normal, not an error. No single database indexes everything (UPCitemdb is
// retail/general-goods leaning, Open Food Facts covers groceries well), so
// we try a short chain of free, no-signup-required sources and return the
// first hit.

const UPCITEMDB_TRIAL_URL = 'https://api.upcitemdb.com/prod/trial/lookup';
const UPCITEMDB_PROD_URL = 'https://api.upcitemdb.com/prod/v1/lookup';
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';

async function fetchJson(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Set UPCITEMDB_API_KEY in .env to switch to their paid endpoint for higher
// volume — see https://www.upcitemdb.com/api/explorer for key setup.
async function lookupUpcItemDb(code) {
  const apiKey = process.env.UPCITEMDB_API_KEY;
  const url = `${apiKey ? UPCITEMDB_PROD_URL : UPCITEMDB_TRIAL_URL}?upc=${encodeURIComponent(code)}`;
  const headers = { Accept: 'application/json' };
  if (apiKey) {
    headers.user_key = apiKey;
    headers.key_type = '3scale';
  }
  const data = await fetchJson(url, { headers });
  const item = data && Array.isArray(data.items) ? data.items[0] : null;
  if (!item) return null;
  return {
    found: true,
    title: item.title || null,
    brand: item.brand || null,
    description: item.description || null,
    category: item.category || null,
    imageUrl: Array.isArray(item.images) && item.images.length ? item.images[0] : null,
  };
}

// Free, no-key, best for groceries/consumer packaged goods.
async function lookupOpenFoodFacts(code) {
  const data = await fetchJson(`${OFF_URL}/${encodeURIComponent(code)}.json`);
  const p = data && data.status === 1 ? data.product : null;
  if (!p) return null;
  return {
    found: true,
    title: p.product_name || null,
    brand: p.brands || null,
    description: p.generic_name || null,
    category: p.categories || null,
    imageUrl: p.image_url || null,
  };
}

const SOURCES = [lookupUpcItemDb, lookupOpenFoodFacts];

async function lookupBarcode(code) {
  for (const source of SOURCES) {
    try {
      const result = await source(code);
      if (result) return result;
    } catch (err) {
      console.warn(`[barcodeLookup] ${source.name} failed`, err.message);
    }
  }
  return { found: false };
}

module.exports = { lookupBarcode };
