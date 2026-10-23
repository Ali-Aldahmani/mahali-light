/**
 * GET /customers/:id/summary feeds the customer hover card: name, phone,
 * total spent, balance (only with customer.view_balance) and the last time
 * the customer paid, across balance payments and invoice payments.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('customer hover summary on real PostgreSQL', () => {
  let db, admin, app, request, token, customerId, emptyId;
  const database = `customer_summary_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  async function invoice(number, status, total, payments) {
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, customer_id, subtotal, discount_amount, taxable_amount, tax_amount, total, amount_paid, balance_due, payment_status, confirmed_at)
       VALUES ($1, $2, $3, $4, 0, $4, 0, $4, $4, 0, 'paid', NOW()) RETURNING id`,
      [number, status, customerId, total],
    );
    for (const [method, amount, at] of payments) {
      await db.query(`INSERT INTO invoice_payments (invoice_id, method, amount, timestamp) VALUES ($1,$2,$3,$4)`, [inv.id, method, amount, at]);
    }
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
    const auth = require('../../server/middleware/auth');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [u.id, auth.hashToken(token)]);

    ({ rows: [{ id: customerId }] } = await db.query(
      `INSERT INTO customers (name, phone, credit_balance, credit_limit) VALUES ('Lena Electric', '0501234567', 150, 5000) RETURNING id`,
    ));
    ({ rows: [{ id: emptyId }] } = await db.query(`INSERT INTO customers (name) VALUES ('New Walk-in') RETURNING id`));

    // Older invoice paid in cash.
    await invoice('INV-T-1', 'confirmed', 300, [['cash', 300, '2026-09-01T10:00:00Z']]);
    // Latest invoice, split cash + bank in one checkout, plus an on-account part that isn't "paid".
    await invoice('INV-T-2', 'confirmed', 500, [['cash', 200, '2026-10-05T12:00:10Z'], ['bank', 150, '2026-10-05T12:00:20Z'], ['credit', 150, '2026-10-05T12:00:20Z']]);
    // A cancelled invoice paid later must be ignored, in totals and in "last paid".
    await invoice('INV-T-3', 'cancelled', 999, [['cash', 999, '2026-10-20T09:00:00Z']]);
    // An older balance payment.
    await db.query(`INSERT INTO customer_payments (customer_id, amount, payment_method, payment_date, created_at) VALUES ($1, 80, 'cash', '2026-09-20', '2026-09-20T08:00:00Z')`, [customerId]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/customers', require('../../server/routes/customers'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  const get = (id) => request(app).get(`/customers/${id}/summary`).auth(token, { type: 'bearer' });

  it('returns name, phone, total spent and balance', async () => {
    const res = await get(customerId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Lena Electric', phone: '0501234567', totalSpent: 800, invoiceCount: 2, creditBalance: 150 });
  });

  it('last payment is the latest checkout, split methods summed, credit left out', async () => {
    const { lastPayment } = (await get(customerId)).body.data;
    expect(lastPayment).toMatchObject({ amount: 350, method: 'split', source: 'invoice' });
    expect(new Date(lastPayment.date).toISOString()).toBe('2026-10-05T12:00:20.000Z');
  });

  it('a newer balance payment wins over invoice payments', async () => {
    await db.query(`INSERT INTO customer_payments (customer_id, amount, payment_method, payment_date, created_at) VALUES ($1, 120, 'bank_transfer', '2026-10-10', '2026-10-10T07:00:00Z')`, [customerId]);
    const { lastPayment } = (await get(customerId)).body.data;
    expect(lastPayment).toMatchObject({ amount: 120, method: 'bank_transfer', source: 'balance' });
  });

  it('a customer who never paid has no last payment and zero spent', async () => {
    const res = await get(emptyId);
    expect(res.body.data).toMatchObject({ name: 'New Walk-in', totalSpent: 0, lastPayment: null });
  });

  it('404s for an unknown customer', async () => {
    expect((await get(randomUUID())).status).toBe(404);
  });
});
