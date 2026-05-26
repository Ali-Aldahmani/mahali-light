require('dotenv').config();
const { getPool, query, withTransaction } = require('./postgres');

// Phase 2: reference data for products & categories.
// Idempotent — safe to run on every server boot.

const ROOT_CATEGORIES = [
  { name: 'Lighting', description: 'All lighting products', requires_serial: false },
  { name: 'Wires & Cables', description: 'Power and data cables', requires_serial: false },
  { name: 'Switches & Sockets', description: 'Electrical switches and sockets', requires_serial: false },
  { name: 'Conduits & Trunking', description: 'Cable management', requires_serial: false },
  { name: 'Distribution & Panels', description: 'DB panels and breakers', requires_serial: false },
  { name: 'Accessories', description: 'Electrical accessories', requires_serial: false },
  { name: 'Tools', description: 'Installation and testing tools', requires_serial: true },
];

const SUBCATEGORIES = [
  // Lighting subcategories
  { parent: 'Lighting', name: 'LED Bulbs', requires_serial: false },
  { parent: 'Lighting', name: 'Ceiling Lights', requires_serial: false },
  { parent: 'Lighting', name: 'Spotlights', requires_serial: false },
  { parent: 'Lighting', name: 'Strip Lights', requires_serial: false },
  { parent: 'Lighting', name: 'Outdoor Lights', requires_serial: false },
  { parent: 'Lighting', name: 'Emergency Lights', requires_serial: false },
  // Wires & Cables subcategories
  { parent: 'Wires & Cables', name: 'Power Cables' },
  { parent: 'Wires & Cables', name: 'Data Cables' },
  { parent: 'Wires & Cables', name: 'Flexible Wires' },
  { parent: 'Wires & Cables', name: 'Armoured Cables' },
  // Switches & Sockets subcategories
  { parent: 'Switches & Sockets', name: 'Light Switches' },
  { parent: 'Switches & Sockets', name: 'Power Sockets' },
  { parent: 'Switches & Sockets', name: 'MCB Breakers' },
];

const ATTRIBUTES = [
  ['Wattage', 'W'],
  ['Voltage', 'V'],
  ['Color Temperature', 'K'],
  ['Fitting Type', null],
  ['IP Rating', null],
  ['Lumens', 'lm'],
  ['Cross Section', 'mm²'],
  ['Number of Cores', null],
  ['Voltage Rating', 'V'],
  ['Material', null],
  ['Insulation', null],
  ['Amperage', 'A'],
  ['Poles', null],
  ['Gang', null],
  ['Diameter', 'mm'],
  ['Length', 'm'],
  ['Color', null],
  ['Brand', null],
  ['Standard', null],
  ['Breaking Capacity', 'kA'],
  ['Curve Type', null],
];

const ATTRIBUTE_VALUES = [
  ['Wattage', '3W', 1], ['Wattage', '5W', 2], ['Wattage', '7W', 3],
  ['Wattage', '9W', 4], ['Wattage', '12W', 5], ['Wattage', '18W', 6],
  ['Wattage', '24W', 7], ['Wattage', '36W', 8],
  ['Color Temperature', '2700K Warm White', 1],
  ['Color Temperature', '4000K Neutral White', 2],
  ['Color Temperature', '6500K Cool White', 3],
  ['Fitting Type', 'E27', 1], ['Fitting Type', 'E14', 2],
  ['Fitting Type', 'GU10', 3], ['Fitting Type', 'GU5.3', 4],
  ['Fitting Type', 'B22', 5],
  ['IP Rating', 'IP20', 1], ['IP Rating', 'IP44', 2],
  ['IP Rating', 'IP65', 3], ['IP Rating', 'IP67', 4],
  ['Cross Section', '1.5mm²', 1], ['Cross Section', '2.5mm²', 2],
  ['Cross Section', '4mm²', 3], ['Cross Section', '6mm²', 4],
  ['Cross Section', '10mm²', 5], ['Cross Section', '16mm²', 6],
  ['Number of Cores', '1', 1], ['Number of Cores', '2', 2],
  ['Number of Cores', '3', 3], ['Number of Cores', '4', 4],
  ['Number of Cores', '5', 5],
  ['Material', 'Copper', 1], ['Material', 'Aluminium', 2],
  ['Material', 'PVC', 3], ['Material', 'Steel', 4],
  ['Insulation', 'PVC', 1], ['Insulation', 'XLPE', 2],
  ['Insulation', 'LSZH', 3],
  ['Amperage', '6A', 1], ['Amperage', '10A', 2], ['Amperage', '13A', 3],
  ['Amperage', '16A', 4], ['Amperage', '20A', 5], ['Amperage', '25A', 6],
  ['Amperage', '32A', 7], ['Amperage', '40A', 8], ['Amperage', '63A', 9],
  ['Poles', '1P', 1], ['Poles', '2P', 2],
  ['Poles', '3P', 3], ['Poles', '4P', 4],
  ['Gang', '1 Gang', 1], ['Gang', '2 Gang', 2], ['Gang', '3 Gang', 3],
  ['Diameter', '16mm', 1], ['Diameter', '20mm', 2], ['Diameter', '25mm', 3],
  ['Diameter', '32mm', 4], ['Diameter', '40mm', 5], ['Diameter', '50mm', 6],
  ['Color', 'White', 1], ['Color', 'Ivory', 2],
  ['Color', 'Black', 3], ['Color', 'Chrome', 4], ['Color', 'Gold', 5],
  ['Standard', 'BS', 1], ['Standard', 'IEC', 2],
  ['Standard', 'UAE ESMA', 3], ['Standard', 'EU', 4],
  ['Breaking Capacity', '6kA', 1], ['Breaking Capacity', '10kA', 2],
  ['Curve Type', 'B', 1], ['Curve Type', 'C', 2], ['Curve Type', 'D', 3],
  ['Voltage', '12V', 1], ['Voltage', '24V', 2],
  ['Voltage', '220V', 3], ['Voltage', '240V', 4], ['Voltage', '415V', 5],
];

// category-name => [attribute-name, is_required, display_order]
const CATEGORY_ATTRIBUTES = {
  Lighting: [
    ['Wattage', true, 1],
    ['Voltage', false, 2],
    ['Color Temperature', false, 3],
    ['Fitting Type', false, 4],
    ['IP Rating', false, 5],
    ['Lumens', false, 6],
  ],
  'Wires & Cables': [
    ['Cross Section', true, 1],
    ['Number of Cores', true, 2],
    ['Voltage Rating', false, 3],
    ['Material', false, 4],
    ['Insulation', false, 5],
  ],
  'Switches & Sockets': [
    ['Amperage', true, 1],
    ['Poles', false, 2],
    ['Gang', false, 3],
    ['Voltage', false, 4],
    ['Color', false, 5],
    ['Standard', false, 6],
  ],
  'Conduits & Trunking': [
    ['Diameter', true, 1],
    ['Length', false, 2],
    ['Material', false, 3],
  ],
  'MCB Breakers': [
    ['Amperage', true, 1],
    ['Poles', true, 2],
    ['Breaking Capacity', false, 3],
    ['Curve Type', false, 4],
    ['Standard', false, 5],
  ],
};

async function ensureRootCategories() {
  for (let i = 0; i < ROOT_CATEGORIES.length; i++) {
    const c = ROOT_CATEGORIES[i];
    await query(
      `INSERT INTO product_categories (name, description, requires_serial, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [c.name, c.description || null, !!c.requires_serial, i + 1],
    );
    // Update sort/description for already-present rows so reseeding stays consistent.
    await query(
      `UPDATE product_categories SET description = COALESCE($2, description),
                                     requires_serial = $3,
                                     sort_order = $4
       WHERE name = $1 AND parent_id IS NULL`,
      [c.name, c.description || null, !!c.requires_serial, i + 1],
    );
  }
}

async function ensureSubcategories() {
  for (let i = 0; i < SUBCATEGORIES.length; i++) {
    const c = SUBCATEGORIES[i];
    const { rows: parent } = await query(
      `SELECT id FROM product_categories WHERE name = $1 AND parent_id IS NULL`,
      [c.parent],
    );
    if (!parent.length) continue;

    const { rows: existing } = await query(
      `SELECT id FROM product_categories WHERE name = $1 AND parent_id = $2`,
      [c.name, parent[0].id],
    );
    if (existing.length) {
      await query(
        `UPDATE product_categories SET requires_serial = $2, sort_order = $3
           WHERE id = $1`,
        [existing[0].id, !!c.requires_serial, i + 1],
      );
    } else {
      await query(
        `INSERT INTO product_categories (name, parent_id, requires_serial, sort_order)
         VALUES ($1,$2,$3,$4)`,
        [c.name, parent[0].id, !!c.requires_serial, i + 1],
      );
    }
  }
}

async function ensureAttributes() {
  for (const [name, unit] of ATTRIBUTES) {
    await query(
      `INSERT INTO product_attributes (name, unit) VALUES ($1,$2)
       ON CONFLICT (name) DO UPDATE SET unit = EXCLUDED.unit`,
      [name, unit],
    );
  }
}

async function ensureAttributeValues() {
  const { rows: attrs } = await query(`SELECT id, name FROM product_attributes`);
  const byName = new Map(attrs.map((a) => [a.name, a.id]));

  for (const [attrName, value, sort] of ATTRIBUTE_VALUES) {
    const attrId = byName.get(attrName);
    if (!attrId) continue;

    const { rows: existing } = await query(
      `SELECT id FROM product_attribute_values WHERE attribute_id = $1 AND value = $2`,
      [attrId, value],
    );
    if (existing.length) {
      await query(
        `UPDATE product_attribute_values SET sort_order = $2 WHERE id = $1`,
        [existing[0].id, sort],
      );
    } else {
      await query(
        `INSERT INTO product_attribute_values (attribute_id, value, sort_order)
         VALUES ($1,$2,$3)`,
        [attrId, value, sort],
      );
    }
  }
}

async function ensureCategoryAttributes() {
  await withTransaction(async (client) => {
    const { rows: attrs } = await client.query(`SELECT id, name FROM product_attributes`);
    const attrByName = new Map(attrs.map((a) => [a.name, a.id]));

    for (const [catName, mapping] of Object.entries(CATEGORY_ATTRIBUTES)) {
      const { rows: cats } = await client.query(
        `SELECT id FROM product_categories WHERE name = $1 LIMIT 1`,
        [catName],
      );
      if (!cats.length) continue;
      const catId = cats[0].id;

      for (const [attrName, isRequired, order] of mapping) {
        const attrId = attrByName.get(attrName);
        if (!attrId) continue;
        await client.query(
          `INSERT INTO category_attributes (category_id, attribute_id, is_required, display_order)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (category_id, attribute_id) DO UPDATE
             SET is_required = EXCLUDED.is_required,
                 display_order = EXCLUDED.display_order`,
          [catId, attrId, !!isRequired, order],
        );
      }
    }
  });
}

async function run() {
  console.log('[seed:products] starting...');
  await ensureRootCategories();
  await ensureSubcategories();
  await ensureAttributes();
  await ensureAttributeValues();
  await ensureCategoryAttributes();
  console.log('[seed:products] done.');
}

if (require.main === module) {
  run()
    .then(() => getPool().end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { run };
