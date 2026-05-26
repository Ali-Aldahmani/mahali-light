require('dotenv').config();
const { getPool, query } = require('./postgres');

// Default application settings — idempotent.
// Read by various modules via the `settings` table.
const DEFAULTS = [
  {
    key: 'inventory.dead_stock_days',
    value: 30,
    description: 'Number of days without movement before stock is considered "dead".',
  },
  {
    key: 'inventory.default_reorder_multiplier',
    value: 2,
    description:
      'Default recommended order quantity when only the reorder threshold is known. The recommended order is threshold * multiplier.',
  },
];

async function run() {
  console.log('[seed:settings] starting...');
  for (const s of DEFAULTS) {
    await query(
      `INSERT INTO settings (key, value, description)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO NOTHING`,
      [s.key, JSON.stringify(s.value), s.description],
    );
  }
  console.log('[seed:settings] done.');
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
