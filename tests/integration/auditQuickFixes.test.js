/**
 * Phase 1 quick fixes from the audit fix plan.
 *
 * - the invoice page's warranty list shows only that invoice's warranties
 * - editing a draft invoice or PO keeps fields the request left out
 * - a bank account named by ID must be active (reversals excepted)
 * - a supplier bank payment records the account it used and its own date,
 *   and its reversal goes back to that account under the reversing user
 * - every token is unique, even two signed in the same second
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('audit quick fixes on real PostgreSQL', () => {
  let db, admin, app, request, auth, token, userId;
  const database = `audit_quick_fixes_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const api = () => ({
    get: (url) => request(app).get(url).auth(token, { type: 'bearer' }),
    put: (url, body) => request(app).put(url).auth(token, { type: 'bearer' }).send(body),
  });

  async function supplier(name) {
    const { rows: [s] } = await db.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [name]);
    return s.id;
  }

  async function bank(name, { isDefault = false, isActive = true, balance = 1000 } = {}) {
    const { rows: [b] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, opening_balance, is_default, is_active)
       VALUES ($1, $1, $2, $2, $3, $4) RETURNING id`,
      [name, balance, isDefault, isActive],
    );
    return b.id;
  }

  async function balanceOf(id) {
    const { rows: [b] } = await db.query(`SELECT current_balance::float8 AS v FROM bank_accounts WHERE id = $1`, [id]);
    return b.v;
  }

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
    auth = require('../../server/middleware/auth');
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/warranties', require('../../server/routes/warranties'));
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it("the invoice page's warranty list shows only that invoice's warranties", async () => {
    const ids = [];
    for (const n of ['INV-W-1', 'INV-W-2']) {
      const { rows: [inv] } = await db.query(
        `INSERT INTO invoices (invoice_number, status, created_by) VALUES ($1, 'confirmed', $2) RETURNING id`,
        [n, userId],
      );
      ids.push(inv.id);
      await db.query(
        `INSERT INTO warranties (warranty_number, invoice_id, start_date, end_date, duration_months)
         VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE + 365, 12)`,
        [`W-${n}`, inv.id],
      );
    }
    const res = await api().get(`/warranties?invoice_id=${ids[0]}&limit=100`);
    expect(res.status).toBe(200);
    const numbers = (res.body.data.items || res.body.data).map((w) => w.warrantyNumber);
    expect(numbers).toEqual(['W-INV-W-1']);
  });

  describe('editing a draft keeps fields the request left out', () => {
    it('invoice: omitted customerId keeps the customer; explicit null removes it', async () => {
      const { rows: [c] } = await db.query(`INSERT INTO customers (name) VALUES ('Keep Me') RETURNING id`);
      const { rows: [inv] } = await db.query(
        `INSERT INTO invoices (invoice_number, status, customer_id, created_by)
         VALUES ('INV-DRAFT-1', 'draft', $1, $2) RETURNING id`,
        [c.id, userId],
      );
      const customerOf = async () =>
        (await db.query(`SELECT customer_id FROM invoices WHERE id = $1`, [inv.id])).rows[0].customer_id;

      expect((await api().put(`/invoices/${inv.id}/items`, { items: [], notes: 'edited' })).status).toBe(200);
      expect(await customerOf()).toBe(c.id);

      expect((await api().put(`/invoices/${inv.id}/items`, { items: [], customerId: null })).status).toBe(200);
      expect(await customerOf()).toBeNull();
    });

    it('PO: omitted dates and notes are kept; sent values change them', async () => {
      const s = await supplier('Keep Dates Co');
      const { rows: [po] } = await db.query(
        `INSERT INTO purchase_orders (po_number, supplier_id, status, expected_date, due_date, notes)
         VALUES ('PO-KEEP-1', $1, 'draft', '2026-11-05', '2026-11-30', 'Call before delivery') RETURNING id`,
        [s],
      );
      const read = async () =>
        (await db.query(
          `SELECT to_char(expected_date,'YYYY-MM-DD') e, to_char(due_date,'YYYY-MM-DD') d, notes FROM purchase_orders WHERE id = $1`,
          [po.id],
        )).rows[0];

      expect((await api().put(`/purchase-orders/${po.id}`, { orderDate: '2026-10-24' })).status).toBe(200);
      expect(await read()).toEqual({ e: '2026-11-05', d: '2026-11-30', notes: 'Call before delivery' });

      expect((await api().put(`/purchase-orders/${po.id}`, { expectedDate: null, notes: 'Changed' })).status).toBe(200);
      expect(await read()).toEqual({ e: null, d: '2026-11-30', notes: 'Changed' });
    });
  });

  describe('bank accounts', () => {
    it('an inactive account named by ID is rejected; a reversal may still use it', async () => {
      const bankService = require('../../server/services/bankService');
      const closed = await bank('Closed Bank', { isActive: false, balance: 500 });
      await expect(
        bankService.recordBankIn({ bankAccountId: closed, transactionType: 'customer_payment', amount: 10, employeeId: userId }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await balanceOf(closed)).toBe(500);

      await bankService.recordBankIn({
        bankAccountId: closed, transactionType: 'supplier_payment', amount: 10, employeeId: userId, allowInactiveAccount: true,
      });
      expect(await balanceOf(closed)).toBe(510);
    });
  });

  describe('supplier bank payment', () => {
    it('records the account used and the payment date, and reverses into that account as the reversing user', async () => {
      const payments = require('../../server/services/supplierPaymentService');
      await db.query(`UPDATE bank_accounts SET is_default = false`);
      const bankA = await bank('Bank A', { isDefault: true });
      const bankB = await bank('Bank B');
      const s = await supplier('Volt Wholesale');
      const { rows: [po] } = await db.query(
        `INSERT INTO purchase_orders (po_number, supplier_id, status, total_cost, amount_paid, balance_due)
         VALUES ('PO-PAY-1', $1, 'received', 200, 0, 200) RETURNING id`,
        [s],
      );

      const { payment } = await payments.addPayment({
        poId: po.id, amount: 50, method: 'bank_transfer', paymentDate: '2026-10-20', employeeId: userId,
      });
      expect(payment.bank_account_id).toBe(bankA);
      const { rows: [saved] } = await db.query(`SELECT bank_account_id FROM supplier_payments WHERE id = $1`, [payment.id]);
      expect(saved.bank_account_id).toBe(bankA);
      const { rows: [out] } = await db.query(
        `SELECT to_char(transaction_date, 'YYYY-MM-DD') AS d FROM bank_transactions
          WHERE bank_account_id = $1 AND direction = 'out'`,
        [bankA],
      );
      expect(out.d).toBe('2026-10-20');
      expect(await balanceOf(bankA)).toBe(950);

      // The default moves to B; the reversal must still return to A.
      await db.query(`UPDATE bank_accounts SET is_default = false`);
      await db.query(`UPDATE bank_accounts SET is_default = true WHERE id = $1`, [bankB]);
      const { rows: [manager] } = await db.query(
        `INSERT INTO users (username, password_hash, role_id)
         SELECT 'reverser', 'x', role_id FROM users WHERE id = $1 RETURNING id`,
        [userId],
      );
      await payments.deletePayment({ paymentId: payment.id, userId: manager.id });

      expect(await balanceOf(bankA)).toBe(1000);
      expect(await balanceOf(bankB)).toBe(1000);
      const { rows: [back] } = await db.query(
        `SELECT employee_id FROM bank_transactions WHERE bank_account_id = $1 AND direction = 'in'`,
        [bankA],
      );
      expect(back.employee_id).toBe(manager.id);
    });
  });

  it('two tokens signed for the same user in the same second differ', () => {
    const jwt = require('jsonwebtoken');
    const a = auth.signToken({ sub: userId, username: 'admin' });
    const b = auth.signToken({ sub: userId, username: 'admin' });
    expect(a).not.toBe(b);
    expect(auth.hashToken(a)).not.toBe(auth.hashToken(b));
    expect(jwt.decode(a).jti).toEqual(expect.any(String));
  });
});
