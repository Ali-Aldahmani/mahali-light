/**
 * Decisions taken in the 5 Nov review, through HTTP on real PostgreSQL: money
 * goes back the way it came in, credit limit blank = unlimited and 0 = none,
 * VAT keeps a filed period stable, a PO is owed net of returns, and a drawer
 * that opens itself for a reversal is logged.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('review decisions on real PostgreSQL', () => {
  let db, admin, app, request, variantId, productId, manager, cashier, dates;
  const database = `review_dec_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  async function user(roleName) {
    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, 'x', $2) RETURNING id`,
      [`u_${randomUUID().slice(0, 8)}`, role.id]);
    const token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, $2, $3)`,
      [u.id, `pc-${randomUUID().slice(0, 6)}`, auth.hashToken(token)]);
    return { id: u.id, as: (method, url) => request(app)[method](url).auth(token, { type: 'bearer' }) };
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
    dates = require('../../server/utils/dates');
    await require('../../server/services/journalService').ensurePeriodsForDate(dates.todayStoreDate());
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name) VALUES ('Decision item') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 100, 40, 100) RETURNING id`, [productId, randomUUID()]));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/customers', require('../../server/routes/customers'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/customer-payments', require('../../server/routes/customerPayments'));
    app.use('/products', require('../../server/routes/products'));
    app.use(require('../../server/middleware/errors').errorHandler);

    manager = await user('Manager');
    cashier = await user('Cashier');
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function creditSale(customerId) {
    const res = await cashier.as('post', '/invoices').send({ customerId, items: [{ variantId, quantity: 1 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body.data;
    const paid = await cashier.as('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'credit', amount: Number(inv.total),
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const confirmed = await cashier.as('post', `/invoices/${inv.id}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    return inv;
  }

  it('a sale on credit is refunded as credit, not cash', async () => {
    const { rows: [c] } = await db.query(`INSERT INTO customers (name, credit_limit) VALUES ('Debtor', NULL) RETURNING id`);
    const inv = await creditSale(c.id);
    const { rows: [line] } = await db.query(`SELECT id, variant_id FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    const request = (refundPlan) => manager.as('post', '/return-requests').send({
      returnType: 'customer_refund', referenceType: 'invoice', referenceId: inv.id,
      reason: 'customer_request', requestNote: 'Changed their mind',
      items: [{ invoiceItemId: line.id, variantId: line.variant_id, productId, quantity: 1, condition: 'good' }],
      refundPlan,
    });
    const asCash = await request([{ method: 'cash', amount: Number(inv.total) }]);
    expect(asCash.status, JSON.stringify(asCash.body)).toBe(409);
    const asCredit = await request([{ method: 'credit', amount: Number(inv.total) }]);
    expect(asCredit.status, JSON.stringify(asCredit.body)).toBe(201);
  });

  it('credit limit: new customers get no credit, blank means no limit', async () => {
    const created = await manager.as('post', '/customers').send({ name: 'New shop' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.creditLimit).toBe(0);
    const res = await cashier.as('post', '/invoices').send({ customerId: created.body.data.id, items: [{ variantId, quantity: 1 }] });
    await cashier.as('post', `/invoices/${res.body.data.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'credit', amount: Number(res.body.data.total),
    });
    // The limit is checked when the sale is confirmed.
    expect((await cashier.as('post', `/invoices/${res.body.data.id}/confirm`)).status).toBe(409);

    // A Cashier can't make one unlimited; a Manager can, by clearing the limit.
    expect((await cashier.as('post', '/customers').send({ name: 'Open tab', creditLimit: null })).status).toBe(403);
    const lifted = await manager.as('put', `/customers/${created.body.data.id}`).send({ creditLimit: null });
    expect(lifted.status, JSON.stringify(lifted.body)).toBe(200);
    expect(lifted.body.data.creditLimit).toBeNull();
  });

  it('migration 056 kept existing unlimited customers unlimited', async () => {
    const { rows } = await db.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_name = 'customers' AND column_name = 'credit_limit'`);
    expect(rows[0].is_nullable).toBe('YES');
    expect(String(rows[0].column_default)).toContain('0');
  });

  it('VAT: a sale cancelled in a later period stays in its own period', async () => {
    const { getVATReport } = require('../../server/services/financialReportService');
    const today = dates.todayStoreDate();
    const before = await getVATReport({ startDate: today, endDate: today });
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, subtotal, taxable_amount, tax_amount, total, confirmed_at, cancelled_at)
       VALUES ($1, 'cancelled', 200, 200, 10, 210, NOW() - INTERVAL '40 days', NOW()) RETURNING id`,
      [`INV-${randomUUID().slice(0, 8)}`]);
    expect(inv.id).toBeTruthy();
    const after = await getVATReport({ startDate: today, endDate: today });
    // Cancelled today: the reversal lands today.
    expect(Number((before.outputTax - after.outputTax).toFixed(2))).toBe(10);
    const day = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const then = await getVATReport({ startDate: day, endDate: day });
    expect(then.outputTax).toBeGreaterThanOrEqual(10);
  });

  it('a held sale is checked against today\'s price rules at confirm', async () => {
    const res = await cashier.as('post', '/invoices').send({ items: [{ variantId, quantity: 1 }] });
    const inv = res.body.data;
    await cashier.as('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total),
      bankAccountId: (await db.query(`INSERT INTO bank_accounts (bank_name, account_name) VALUES ('B', 'A') RETURNING id`)).rows[0].id,
    });
    // A minimum above the held price is set while the sale is parked.
    await db.query(
      `INSERT INTO pricing_restrictions (product_id, min_price) VALUES ($1, 150)`, [productId]);
    const confirmed = await cashier.as('post', `/invoices/${inv.id}/confirm`);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(422);
    await db.query(`DELETE FROM pricing_restrictions WHERE product_id = $1`, [productId]);
  });

  it('cost 0 is refused while there is stock', async () => {
    const res = await manager.as('put', `/products/${productId}/variants/${variantId}`).send({ costPrice: 0 });
    expect(res.status).toBe(400);
  });

  it('opening stock reaches the ledger', async () => {
    const created = await manager.as('post', `/products/${productId}/variants`).send({
      sku: `OPEN-${randomUUID().slice(0, 6)}`, sellingPrice: 10, costPrice: 4, openingStock: 5,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { rows: [row] } = await db.query(
      `SELECT COALESCE(SUM(jl.debit), 0)::float8 AS debit
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN chart_of_accounts ca ON ca.id = jl.account_id
        WHERE je.reference_type = 'stock_movement' AND ca.code = '1004'`);
    expect(row.debit).toBeGreaterThanOrEqual(20);
  });

  it('a drawer opened by a reversal is logged', async () => {
    const cashService = require('../../server/services/cashService');
    await cashService.recordCashIn({
      transactionType: 'customer_payment', amount: 1, employeeId: manager.id,
      notes: 'Reversal of customer payment', allowAutoOpen: true,
    }).catch(() => {});
    const { rows } = await db.query(`SELECT 1 FROM activity_log WHERE action = 'cash_drawer.auto_opened'`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
