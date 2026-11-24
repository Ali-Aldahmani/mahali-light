/**
 * Sales and reorder alerts (software engineering audit, 22 Nov 2026):
 *   F-TX-03  a sale that crosses the reorder point emits the live
 *            reorder_alert_created event after commit (it was dropped)
 *   F-TX-04  a pending alert opened meanwhile (sweep job, another till) no
 *            longer aborts the sale's transaction
 *
 * Uses the production confirmInvoice on its own throwaway database.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('sale reorder alerts on real PostgreSQL', () => {
  let admin, db, confirmInvoice;
  const database = `sale_reorder_${randomUUID().replaceAll('-', '')}`;
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
    await require('../../server/services/journalService').ensurePeriodsForDate(
      require('../../server/utils/dates').todayStoreDate(),
    );
    await db.query(
      `INSERT INTO cash_drawer (name, status, current_balance)
       SELECT 'Test drawer', 'open', 100 WHERE NOT EXISTS (SELECT 1 FROM cash_drawer)`,
    );
    await db.query(`UPDATE cash_drawer SET status = 'open'`);
    ({ confirmInvoice } = require('../../server/services/invoiceService.js'));
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.closePool();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  // A product with `stock` units and a reorder threshold of 5, and a cash
  // draft invoice selling `qty` of it.
  async function saleOf({ stock, qty }) {
    const sku = `RO-${randomUUID().slice(0, 8)}`;
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, unit_label, is_active, reorder_threshold)
       VALUES ($1, 'pcs', true, 5) RETURNING id`, [`Lamp ${sku}`],
    );
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, is_active, reorder_threshold)
       VALUES ($1, $2, 10, 5, $3, true, 5) RETURNING id`, [p.id, sku, stock],
    );
    const total = Number((qty * 10 * 1.05).toFixed(2));
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, tax_rate, pc_identifier)
       VALUES ($1, 'draft', 5, 'TEST') RETURNING id`, [`INV-${sku}`],
    );
    await db.query(
      `INSERT INTO invoice_items
         (invoice_id, product_id, variant_id, product_name, sku, unit_label,
          quantity, unit_price, cost_price_at_time, line_subtotal, line_total, position)
       VALUES ($1,$2,$3,$4,$5,'pcs',$6,10,5,$7,$7,0)`,
      [inv.id, p.id, v.id, `Lamp ${sku}`, sku, qty, qty * 10],
    );
    await db.query(
      `INSERT INTO invoice_payments (invoice_id, method, amount) VALUES ($1, 'cash', $2)`, [inv.id, total],
    );
    return { productId: p.id, variantId: v.id, invoiceId: inv.id };
  }

  function recordingIo() {
    const events = [];
    const target = { emit: (event, payload) => events.push({ event, payload }) };
    return { events, to: () => target, in: () => target, emit: target.emit };
  }

  it('emits reorder_alert_created after a sale drops stock to the reorder point (F-TX-03)', async () => {
    const { variantId, invoiceId } = await saleOf({ stock: 8, qty: 4 });
    const io = recordingIo();
    await confirmInvoice({ invoiceId, employeeId: null, io });

    const { rows } = await db.query(
      `SELECT status FROM reorder_alerts WHERE variant_id = $1`, [variantId],
    );
    expect(rows).toEqual([{ status: 'pending' }]);
    const alertEvents = io.events.filter((e) => e.event === 'reorder_alert_created');
    expect(alertEvents).toHaveLength(1);
    expect(alertEvents[0].payload.variantId).toBe(variantId);
    expect(io.events.some((e) => e.event === 'stock_updated')).toBe(true);
  });

  it('a sale still succeeds when the reorder check fails part-way (F-TX-04)', async () => {
    const { variantId, invoiceId } = await saleOf({ stock: 8, qty: 4 });
    // Make the check's INSERT fail inside the sale transaction: a trigger
    // that raises for this variant only. Before the savepoint, the sale
    // then failed with "current transaction is aborted" (25P02).
    await db.query(`
      CREATE OR REPLACE FUNCTION test_fail_reorder() RETURNS trigger AS $$
      BEGIN
        IF NEW.variant_id = '${variantId}'::uuid THEN
          RAISE EXCEPTION 'reorder insert failed on purpose';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.query(`
      CREATE TRIGGER test_fail_reorder BEFORE INSERT ON reorder_alerts
      FOR EACH ROW EXECUTE FUNCTION test_fail_reorder()`);
    try {
      const result = await confirmInvoice({ invoiceId, employeeId: null, io: null });
      expect(result).toBeTruthy();
      const { rows: [inv] } = await db.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId]);
      expect(inv.status).toBe('confirmed');
      const { rows: [v] } = await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [variantId]);
      expect(Number(v.stock_qty)).toBe(4);
      const { rows: alerts } = await db.query(`SELECT 1 FROM reorder_alerts WHERE variant_id = $1`, [variantId]);
      expect(alerts).toHaveLength(0);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS test_fail_reorder ON reorder_alerts`);
      await db.query(`DROP FUNCTION IF EXISTS test_fail_reorder()`);
    }
  });
});
