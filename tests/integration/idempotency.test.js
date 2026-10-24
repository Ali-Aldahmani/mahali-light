/**
 * Phase 3 of the audit fix plan: money and stock commands are safe to retry.
 *
 * For every command, the same request sent twice with one Idempotency-Key
 * must have exactly one effect, and the retry must get the first result back
 * (200 instead of 201). The same key with different details is refused (409);
 * requests without a key keep working as before.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('retry-safe commands on real PostgreSQL', () => {
  let db, admin, app, request, token, userId;
  const database = `idempotency_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const post = (url, body, key) => {
    const r = request(app).post(url).auth(token, { type: 'bearer' });
    if (key) r.set('Idempotency-Key', key);
    return r.send(body);
  };
  const n = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

  // Sends the same command twice with one key and returns both responses.
  async function twice(url, body) {
    const key = randomUUID();
    const first = await post(url, body, key);
    const second = await post(url, body, key);
    return { first, second, key };
  }

  async function bank(name, balance = 5000) {
    return (await one(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, opening_balance, is_default)
       VALUES ($1, $1, $2, $2, NOT EXISTS (SELECT 1 FROM bank_accounts WHERE is_default)) RETURNING id`,
      [name, balance],
    )).id;
  }
  async function supplierPo({ total = 500, status = 'received' } = {}) {
    const s = await one(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Supplier ${randomUUID().slice(0, 6)}`]);
    return one(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, total_cost, amount_paid, balance_due)
       VALUES ($1, $2, $3, $4, 0, $4) RETURNING id`,
      [`PO-${randomUUID().slice(0, 8)}`, s.id, status, total],
    );
  }
  async function variant(stock = 10) {
    const p = await one(`INSERT INTO products (name) VALUES ('Idempotency item') RETURNING id`);
    return one(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 100, 40, $3) RETURNING id, product_id`,
      [p.id, randomUUID(), stock],
    );
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
    await db.query(`INSERT INTO financial_periods (name,period_type,start_date,end_date)
      SELECT 'Idempotency current year','yearly',date_trunc('year', CURRENT_DATE)::date,
        (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date
      WHERE NOT EXISTS (SELECT 1 FROM financial_periods WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)`);
    const auth = require('../../server/middleware/auth');
    ({ id: userId } = await one(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/customers', require('../../server/routes/customers'));
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use('/expenses', require('../../server/routes/expenses'));
    app.use('/cash-drawer', require('../../server/routes/cashDrawer'));
    app.use('/bank-accounts', require('../../server/routes/bankAccounts'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));

    // An open, counted drawer with float for the cash commands.
    expect((await post('/cash-drawer/open', { openingBalance: 2000 })).status).toBe(201);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('customer collection: one payment, one balance reduction', async () => {
    const c = await one(`INSERT INTO customers (name, credit_balance) VALUES ('Debt Co', 500) RETURNING id`);
    const { first, second } = await twice(`/customers/${c.id}/payments`, { amount: 100, paymentMethod: 'cash' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.payment.id).toBe(first.body.data.payment.id);
    expect(await n(`SELECT COUNT(*) AS n FROM customer_payments WHERE customer_id = $1`, [c.id])).toBe(1);
    expect(Number((await one(`SELECT credit_balance FROM customers WHERE id = $1`, [c.id])).credit_balance)).toBe(400);
  });

  it('supplier payment: one payment, one cash outflow', async () => {
    const po = await supplierPo();
    const cashOutBefore = await n(`SELECT COUNT(*) AS n FROM cash_drawer_transactions WHERE transaction_type = 'supplier_payment'`);
    const { first, second } = await twice(`/purchase-orders/${po.id}/payments`, { amount: 120, paymentMethod: 'cash' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.payment.id).toBe(first.body.data.payment.id);
    expect(await n(`SELECT COUNT(*) AS n FROM supplier_payments WHERE purchase_order_id = $1`, [po.id])).toBe(1);
    expect(Number((await one(`SELECT amount_paid FROM purchase_orders WHERE id = $1`, [po.id])).amount_paid)).toBe(120);
    expect(await n(`SELECT COUNT(*) AS n FROM cash_drawer_transactions WHERE transaction_type = 'supplier_payment'`)).toBe(cashOutBefore + 1);
  });

  it('PO receipt: a replayed partial receipt adds the goods once', async () => {
    const v = await variant(0);
    const po = await supplierPo({ total: 400, status: 'confirmed' });
    const item = await one(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, variant_id, quantity, cost_price_per_unit, total_cost)
       VALUES ($1, $2, $3, 10, 40, 400) RETURNING id`,
      [po.id, v.product_id, v.id],
    );
    const { first, second } = await twice(`/purchase-orders/${po.id}/receive`, { items: [{ id: item.id, quantityReceived: 2 }] });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Number((await one(`SELECT quantity_received FROM purchase_order_items WHERE id = $1`, [item.id])).quantity_received)).toBe(2);
    expect(Number((await one(`SELECT stock_qty FROM product_variants WHERE id = $1`, [v.id])).stock_qty)).toBe(2);
    expect(await n(`SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = $1`, [v.id])).toBe(1);
  });

  it('expense: one expense, one cash outflow', async () => {
    const body = { description: 'Showroom cleaning', amount: 75, paymentMethod: 'cash' };
    const { first, second } = await twice('/expenses', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await n(`SELECT COUNT(*) AS n FROM one_time_expenses WHERE description = 'Showroom cleaning'`)).toBe(1);
  });

  it('cash adjustment: the drawer moves once', async () => {
    const before = Number((await one(`SELECT current_balance FROM cash_drawer`)).current_balance);
    const { first, second } = await twice('/cash-drawer/adjust', { amount: 30, direction: 'out', reason: 'Petty cash for tea' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Number((await one(`SELECT current_balance FROM cash_drawer`)).current_balance)).toBe(before - 30);
    expect(await n(`SELECT COUNT(*) AS n FROM cash_drawer_transactions WHERE notes = 'Petty cash for tea'`)).toBe(1);
  });

  it('cash to bank transfer: one transfer, both sides once', async () => {
    const b = await bank('Transfer Bank', 0);
    const { first, second } = await twice('/cash-drawer/transfer', { toType: 'bank_account', toId: b, amount: 200 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.transferId).toBe(first.body.data.transferId);
    expect(await n(`SELECT COUNT(*) AS n FROM cash_transfers WHERE to_id = $1`, [b])).toBe(1);
    expect(Number((await one(`SELECT current_balance FROM bank_accounts WHERE id = $1`, [b])).current_balance)).toBe(200);
  });

  it('bank deposit and withdrawal: each moves the balance once', async () => {
    const b = await bank('Movement Bank', 1000);
    const dep = await twice(`/bank-accounts/${b}/deposit`, { amount: 250, description: 'Cheque deposit' });
    expect([dep.first.status, dep.second.status]).toEqual([201, 200]);
    expect(dep.second.body.data.id).toBe(dep.first.body.data.id);
    const wd = await twice(`/bank-accounts/${b}/withdrawal`, { amount: 100, description: 'Bank charge' });
    expect([wd.first.status, wd.second.status]).toEqual([201, 200]);
    expect(Number((await one(`SELECT current_balance FROM bank_accounts WHERE id = $1`, [b])).current_balance)).toBe(1150);
    expect(await n(`SELECT COUNT(*) AS n FROM bank_transactions WHERE bank_account_id = $1`, [b])).toBe(2);
  });

  it('bank transfer: one transfer between accounts', async () => {
    const from = await bank('From Bank', 1000);
    const to = await bank('To Bank', 0);
    const { first, second } = await twice(`/bank-accounts/${from}/transfer`, { toType: 'bank_account', toId: to, amount: 300 });
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(Number((await one(`SELECT current_balance FROM bank_accounts WHERE id = $1`, [from])).current_balance)).toBe(700);
    expect(Number((await one(`SELECT current_balance FROM bank_accounts WHERE id = $1`, [to])).current_balance)).toBe(300);
  });

  it('direct stock adjustment: stock moves once', async () => {
    const v = await variant(10);
    const { first, second } = await twice('/stock/adjustments', {
      variantId: v.id, adjustmentType: 'remove', quantity: 2, reason: 'damaged',
      note: 'Cracked in the storeroom', applyDirectly: true,
    });
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(Number((await one(`SELECT stock_qty FROM product_variants WHERE id = $1`, [v.id])).stock_qty)).toBe(8);
    expect(await n(`SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = $1`, [v.id])).toBe(1);
  });

  describe('the key itself', () => {
    it('a key reused with different details is refused and changes nothing', async () => {
      const c = await one(`INSERT INTO customers (name, credit_balance) VALUES ('Mismatch Co', 500) RETURNING id`);
      const key = randomUUID();
      expect((await post(`/customers/${c.id}/payments`, { amount: 50, paymentMethod: 'cash' }, key)).status).toBe(201);
      const reused = await post(`/customers/${c.id}/payments`, { amount: 90, paymentMethod: 'cash' }, key);
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(Number((await one(`SELECT credit_balance FROM customers WHERE id = $1`, [c.id])).credit_balance)).toBe(450);
    });

    it('two simultaneous requests with one key have one effect', async () => {
      const c = await one(`INSERT INTO customers (name, credit_balance) VALUES ('Race Co', 500) RETURNING id`);
      const key = randomUUID();
      const results = await Promise.all([1, 2, 3].map(() =>
        post(`/customers/${c.id}/payments`, { amount: 100, paymentMethod: 'cash' }, key)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(await n(`SELECT COUNT(*) AS n FROM customer_payments WHERE customer_id = $1`, [c.id])).toBe(1);
      expect(Number((await one(`SELECT credit_balance FROM customers WHERE id = $1`, [c.id])).credit_balance)).toBe(400);
    });

    it('without a key two genuine payments both go through, as before', async () => {
      const c = await one(`INSERT INTO customers (name, credit_balance) VALUES ('Two Payments Co', 500) RETURNING id`);
      expect((await post(`/customers/${c.id}/payments`, { amount: 100, paymentMethod: 'cash' })).status).toBe(201);
      expect((await post(`/customers/${c.id}/payments`, { amount: 100, paymentMethod: 'cash' })).status).toBe(201);
      expect(Number((await one(`SELECT credit_balance FROM customers WHERE id = $1`, [c.id])).credit_balance)).toBe(300);
    });
  });
});
