/**
 * Live two-connection race: last unit, two confirms.
 * Guard: RUN_PG_CONCURRENCY=1
 * Uses real PostgreSQL + production confirmInvoice (no lock mocks).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const enabled = process.env.RUN_PG_CONCURRENCY === '1';
const require = createRequire(import.meta.url);

describe('live Postgres last-unit race', () => {
  it.skipIf(!enabled)(
    'only one of two concurrent confirms succeeds when stock is 1',
    async () => {
      require('dotenv').config({ path: path.join(process.cwd(), '.env') });
      const { query } = require('../../server/db/postgres.js');
      const { confirmInvoice } = require('../../server/services/invoiceService.js');
      const { ERROR_CODES } = require('../../shared/errorCodes.js');

      await query('SELECT 1');

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
        if (invA) await query(`DELETE FROM invoice_payments WHERE invoice_id = $1`, [invA]);
        if (invB) await query(`DELETE FROM invoice_payments WHERE invoice_id = $1`, [invB]);
        if (invB) await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invB]);
        if (invA) await query(`DELETE FROM invoice_history WHERE invoice_id = $1`, [invA]).catch(() => {});
        if (invB) await query(`DELETE FROM invoice_history WHERE invoice_id = $1`, [invB]).catch(() => {});
        if (variantId) {
          await query(`DELETE FROM stock_movements WHERE variant_id = $1`, [variantId]);
        }
        if (invA) await query(`DELETE FROM invoices WHERE id = $1`, [invA]);
        if (invB) await query(`DELETE FROM invoices WHERE id = $1`, [invB]);
        if (variantId) await query(`DELETE FROM product_variants WHERE id = $1`, [variantId]);
        if (productId) await query(`DELETE FROM products WHERE id = $1`, [productId]);
      }
    },
    60000,
  );
});
