/**
 * Reconciliation report (scripts/reconcile.js).
 *
 * A freshly migrated database reconciles cleanly, and each planted mismatch
 * is reported by the check meant to catch it.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('reconciliation report on real PostgreSQL', () => {
  let db, admin, reconcile;
  const database = `reconcile_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const differences = async (id) => {
    const results = await reconcile(db.getPool());
    const r = results.find((x) => x.id === id);
    expect(r.error).toBeUndefined();
    return r.differences;
  };

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
    ({ reconcile } = require('../../scripts/reconcile'));
  }, 30000);

  afterAll(async () => {
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('every check runs and a fresh database has no differences', async () => {
    const results = await reconcile(db.getPool());
    expect(results.filter((r) => r.error)).toEqual([]);
    expect(results.flatMap((r) => r.differences)).toEqual([]);
  });

  it('flags a customer balance that does not match their credit sales', async () => {
    await db.query(`INSERT INTO customers (name, credit_balance) VALUES ('Drift Co', 50)`);
    const rows = await differences('customer_balance');
    expect(rows).toEqual([expect.objectContaining({ item: 'Drift Co', recorded: 50, expected: 0 })]);
  });

  it('flags a purchase order whose paid amount has no payment rows', async () => {
    const { rows: [s] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Volt Supply') RETURNING id`);
    await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, total_cost, amount_paid, balance_due)
       VALUES ('PO-RECON-1', $1, 'received', 100, 40, 60)`,
      [s.id],
    );
    const rows = await differences('po_paid');
    expect(rows).toEqual([expect.objectContaining({ item: 'PO-RECON-1', recorded: 40, expected: 0 })]);
  });

  it('flags a drawer reopened with a different amount than it closed with', async () => {
    const { rows: [d] } = await db.query(`SELECT id FROM cash_drawer LIMIT 1`);
    const rows = [
      ['opening', 'in', 500, 0, 500, '2026-01-01 09:00+04'],
      ['closing', 'out', 0, 500, 500, '2026-01-01 18:00+04'],
      ['opening', 'in', 100, 0, 100, '2026-01-02 09:00+04'],
    ];
    for (const [type, dir, amount, before, after, at] of rows) {
      await db.query(
        `INSERT INTO cash_drawer_transactions
           (cash_drawer_id, transaction_type, direction, amount, balance_before, balance_after, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [d.id, type, dir, amount, before, after, at],
      );
    }
    expect(await differences('drawer_reopen')).toEqual([
      expect.objectContaining({ recorded: 100, expected: 500 }),
    ]);
    // Openings start from 0 by convention, so they are not a broken chain.
    expect(await differences('drawer_chain')).toEqual([]);
  });

  it('runs read-only', async () => {
    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      await expect(client.query(`UPDATE customers SET name = name`)).rejects.toThrow(/read-only/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
