/**
 * The database refuses impossible money and stock values on its own
 * (migration 047; atomicity audit TXA-011, invoice audit F21), whatever
 * code path writes them.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('database constraints on real PostgreSQL', () => {
  let db, admin;
  const database = `db_constraints_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  beforeAll(async () => {
    Object.assign(process.env, {
      PGHOST: '127.0.0.1', PGPORT: process.env.INVOICE_TEST_PG_PORT,
      PGUSER: process.env.INVOICE_TEST_PG_USER || 'postgres',
      PGPASSWORD: process.env.INVOICE_TEST_PG_PASSWORD || '', PGDATABASE: database,
    });
    const { Pool } = require('pg');
    admin = new Pool({ database: 'postgres' });
    await admin.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;
    db = require('../../server/db/postgres');
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();
  }, 30000);

  afterAll(async () => {
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('refuses negative stock, a negative drawer and over-receipt', async () => {
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Lamp') RETURNING id`);
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 10, 4, 1) RETURNING id`, [p.id, randomUUID()]);
    await expect(db.query(`UPDATE product_variants SET stock_qty = -1 WHERE id = $1`, [v.id]))
      .rejects.toThrow(/chk_variant_stock_nonneg/);
    await expect(db.query(`UPDATE cash_drawer SET current_balance = -5`))
      .rejects.toThrow(/chk_drawer_balance_nonneg/);

    const { rows: [s] } = await db.query(`INSERT INTO suppliers (name) VALUES ('S') RETURNING id`);
    const { rows: [po] } = await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id) VALUES ($1, $2) RETURNING id`, [`PO-${randomUUID()}`, s.id]);
    await expect(db.query(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, variant_id, quantity, quantity_received, cost_price_per_unit, total_cost)
       VALUES ($1, $2, $3, 2, 3, 4, 8)`, [po.id, p.id, v.id])).rejects.toThrow(/chk_po_item_received_range/);
  });

  it('refuses an unbalanced journal entry at commit', async () => {
    const { rows: [cash] } = await db.query(`SELECT id FROM chart_of_accounts WHERE code = '1001'`);
    const { rows: [rev] } = await db.query(`SELECT id FROM chart_of_accounts WHERE code = '4001'`);
    const entry = (client, n) => client.query(
      `INSERT INTO journal_entries (entry_number, date, description) VALUES ($1, CURRENT_DATE, 'test') RETURNING id`, [n]);

    await expect(db.withTransaction(async (client) => {
      const { rows: [e] } = await entry(client, `JE-BAD-${randomUUID()}`);
      await client.query(`INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 10, 0)`, [e.id, cash.id]);
    })).rejects.toThrow(/not balanced/);

    // Lines added one by one still commit when the entry balances.
    await db.withTransaction(async (client) => {
      const { rows: [e] } = await entry(client, `JE-OK-${randomUUID()}`);
      await client.query(`INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 10, 0)`, [e.id, cash.id]);
      await client.query(`INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 0, 10)`, [e.id, rev.id]);
    });
  });
});
