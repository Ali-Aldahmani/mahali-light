const { query } = require('../db/postgres');
const { codeFromName, pad, randomDigits } = require('./codes');

// Resolve the category code (used in SKU + internal barcode prefixes).
// Walks up the parent chain to the root category, since "LED Bulbs"
// should map back to "LGT" (Lighting).
async function getCategoryCode(categoryId) {
  if (!categoryId) return 'GEN';
  let id = categoryId;
  let name = null;
  for (let i = 0; i < 5; i++) {
    const { rows } = await query(
      `SELECT name, parent_id FROM product_categories WHERE id = $1`,
      [id],
    );
    if (!rows.length) break;
    name = rows[0].name;
    if (!rows[0].parent_id) break;
    id = rows[0].parent_id;
  }
  return codeFromName(name || 'GEN', 'GEN', 3);
}

// Returns a unique INT-XXX-NNNNNN barcode (max 50 tries).
async function generateUniqueInternalBarcode(categoryId) {
  const code = await getCategoryCode(categoryId);
  for (let i = 0; i < 50; i++) {
    const candidate = `INT-${code}-${randomDigits(6)}`;
    const { rows } = await query(
      `SELECT 1 FROM product_variants WHERE internal_barcode = $1 LIMIT 1`,
      [candidate],
    );
    if (!rows.length) return candidate;
  }
  // Final fallback uses higher entropy.
  return `INT-${code}-${Date.now().toString().slice(-9)}`;
}

// Returns a unique SKU: {CAT}-{BRAND}-{NNNN}.
async function generateUniqueSku({ categoryId, brand }) {
  const cat = await getCategoryCode(categoryId);
  const brandCode = codeFromName(brand || 'GEN', 'GEN', 3);

  // Find the highest existing numeric suffix for this prefix and increment.
  const prefix = `${cat}-${brandCode}-`;
  const { rows } = await query(
    `SELECT sku FROM product_variants
      WHERE sku LIKE $1
      ORDER BY sku DESC LIMIT 1`,
    [`${prefix}%`],
  );

  let nextSeq = 1;
  if (rows.length) {
    const lastSeg = rows[0].sku.slice(prefix.length);
    const num = parseInt(lastSeg, 10);
    if (!Number.isNaN(num)) nextSeq = num + 1;
  }

  for (let i = 0; i < 50; i++) {
    const candidate = `${prefix}${pad(nextSeq + i, 4)}`;
    const { rows: dup } = await query(
      `SELECT 1 FROM product_variants WHERE sku = $1 LIMIT 1`,
      [candidate],
    );
    if (!dup.length) return candidate;
  }
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

module.exports = {
  getCategoryCode,
  generateUniqueInternalBarcode,
  generateUniqueSku,
};
