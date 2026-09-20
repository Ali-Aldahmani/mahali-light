/**
 * Live two-connection race: last unit, two confirms.
 * Guard: RUN_PG_CONCURRENCY=1 (also needs INVOICE_TEST_PG_PORT — see below)
 * Uses real PostgreSQL + production confirmInvoice (no lock mocks).
 *
 * Creates and drops its own database on an explicitly selected local test
 * server, the same way tests/integration/invoiceIntegrity.test.js does. No
 * production credentials or database names are loaded from .env.
 *
 * This file used to `dotenv.config({ path: '.env' })` and rely on
 * server/db/postgres.js's bare PG* defaults (PGDATABASE falls back to
 * 'mahali_light' when unset) instead of creating an isolated database like
 * its sibling live-DB test files do. Locally that accidentally connected to
 * a real, separate local PostgreSQL instance with genuine data (its own
 * transactional cleanup happened to leave no trace, confirmed after the
 * fact) rather than an isolated test database; in CI, where no such
 * ambient database exists at all, it failed outright with "database
 * mahali_light does not exist". Fixed to match the isolated pattern.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = process.env.RUN_PG_CONCURRENCY === '1' && Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('live Postgres last-unit race', () => {
  let admin, db;
  const database = `concurrency_regression_${randomUUID().replaceAll('-', '')}`;
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
    await db.query(`INSERT INTO financial_periods (name,period_type,start_date,end_date)
      SELECT 'Regression current year','yearly',date_trunc('year', CURRENT_DATE)::date,
        (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date
      WHERE NOT EXISTS (SELECT 1 FROM financial_periods WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)`);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it(
    'only one of two concurrent confirms succeeds when stock is 1',
    async () => {
      const { query } = db;
      const { confirmInvoice } = require('../../server/services/invoiceService.js');
      const { ERROR_CODES } = require('../../shared/errorCodes.js');

      const sku = `CONC-${randomUUID().slice(0, 8)}`;
      const tag = `concurrency-test ${sku}`;
      let productId;
      let variantId;
      let invA;
      let invB;

      try {
        const p = await query(
          `INSERT INTO products (name, unit_label, is_active)
           VALUES ($1, 'pcs', true) RETURNING id`,
          [tag],
        );
        productId = p.rows[0].id;
        const v = await query(
          `INSERT INTO product_variants
             (product_id, sku, selling_price, cost_price, stock_qty, is_active)
           VALUES ($1, $2, 10, 5, 1, true)
           RETURNING id`,
          [productId, sku],
        );
        variantId = v.rows[0].id;

        const mkInv = async (suffix) => {
          const inv = await query(
            `INSERT INTO invoices (invoice_number, status, tax_rate, pc_identifier)
             VALUES ($1, 'draft', 5, 'CONC')
             RETURNING id`,
            [`${sku}-${suffix}`],
          );
          const id = inv.rows[0].id;
          await query(
            `INSERT INTO invoice_items
               (invoice_id, product_id, variant_id, product_name, sku, unit_label,
                quantity, unit_price, cost_price_at_time, line_subtotal, line_total, position)
             VALUES ($1,$2,$3,$4,$5,'pcs',1,10,5,10,10,0)`,
            [id, productId, variantId, tag, sku],
          );
          return id;
        };
        invA = await mkInv('A');
        invB = await mkInv('B');

        await query(
          `INSERT INTO invoice_payments (invoice_id, method, amount, notes)
           VALUES ($1, 'cash', 10.50, 'concurrency'), ($2, 'cash', 10.50, 'concurrency')`,
          [invA, invB],
        );
        await query(
          `UPDATE cash_drawer SET status = 'open', updated_at = NOW()
            WHERE id = (SELECT id FROM cash_drawer ORDER BY updated_at ASC LIMIT 1)`,
        );
        await query(
          `INSERT INTO cash_drawer (name, status, current_balance)
           SELECT 'CONC drawer', 'open', 100
           WHERE NOT EXISTS (SELECT 1 FROM cash_drawer)`,
        );

        const results = await Promise.allSettled([
          confirmInvoice({ invoiceId: invA, employeeId: null, io: null }),
          confirmInvoice({ invoiceId: invB, employeeId: null, io: null }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        if (fulfilled.length !== 1) {
          const msgs = rejected.map((r) => r.reason?.message || r.reason?.code || String(r.reason));
          throw new Error(
            `expected 1 success, got ${fulfilled.length}; failures: ${msgs.join(' | ')}`,
          );
        }
        expect(rejected.length).toBe(1);
        expect(rejected[0].reason.code).toBe(ERROR_CODES.BIZ_INSUFFICIENT_STOCK);
        expect(rejected[0].reason.status).toBe(422);

        const stock = await query(
          `SELECT stock_qty FROM product_variants WHERE id = $1`,
          [variantId],
        );
        expect(Number(stock.rows[0].stock_qty)).toBe(0);
        expect(Number(stock.rows[0].stock_qty)).toBeGreaterThanOrEqual(0);

        const invStates = await query(
          `SELECT id, status FROM invoices WHERE id = ANY($1::uuid[])`,
          [[invA, invB]],
        );
        const statuses = invStates.rows.map((r) => r.status).sort();
        expect(statuses).toEqual(['confirmed', 'draft']);

        const moves = await query(
          `SELECT quantity, qty_before, qty_after, movement_type
             FROM stock_movements
            WHERE variant_id = $1 AND reference_type = 'invoice'`,
          [variantId],
        );
        expect(moves.rows).toHaveLength(1);
        expect(Number(moves.rows[0].qty_after)).toBe(0);
        expect(Number(moves.rows[0].qty_before)).toBe(1);
      } finally {
        // Best-effort cleanup only matters if the test runs against a
        // shared/ambient database; against this file's own throwaway
        // database (dropped whole in afterAll) it's redundant but harmless.
        if (invA) await query(`DELETE FROM invoice_payments WHERE invoice_id = $1`, [invA]).catch(() => {});
        if (invB) await query(`DELETE FROM invoice_payments WHERE invoice_id = $1`, [invB]).catch(() => {});
        if (invB) await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invB]).catch(() => {});
        if (invA) await query(`DELETE FROM invoice_history WHERE invoice_id = $1`, [invA]).catch(() => {});
        if (invB) await query(`DELETE FROM invoice_history WHERE invoice_id = $1`, [invB]).catch(() => {});
        if (variantId) {
          await query(`DELETE FROM stock_movements WHERE variant_id = $1`, [variantId]).catch(() => {});
        }
        if (invA) await query(`DELETE FROM invoices WHERE id = $1`, [invA]).catch(() => {});
        if (invB) await query(`DELETE FROM invoices WHERE id = $1`, [invB]).catch(() => {});
        if (variantId) await query(`DELETE FROM product_variants WHERE id = $1`, [variantId]).catch(() => {});
        if (productId) await query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => {});
      }
    },
    60000,
  );
});
