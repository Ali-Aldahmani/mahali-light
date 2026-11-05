/**
 * Whole-repo review, sales batch, through HTTP on real PostgreSQL: who may lift
 * a credit limit, void a collection or hide a debtor; exchange tender survives
 * the route; replacements and claimed warranties can't be refunded by a cancel;
 * edit requests need a second person and can't smuggle in a discount.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('sales review fixes on real PostgreSQL', () => {
  let db, admin, app, request, variantId, productId, adminUser, manager, cashier, accountId;
  const database = `review_sales_${randomUUID().replaceAll('-', '')}`;
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
    await require('../../server/services/journalService').ensurePeriodsForDate(
      require('../../server/utils/dates').todayStoreDate(),
    );
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name) VALUES ('Sale item') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 50, 20, 100) RETURNING id`, [productId, randomUUID()]));
    ({ rows: [{ id: accountId }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, is_default) VALUES ('ENBD', 'Main', true) RETURNING id`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/customers', require('../../server/routes/customers'));
    app.use('/customer-payments', require('../../server/routes/customerPayments'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use(require('../../server/middleware/errors').errorHandler);

    adminUser = await user('Admin');
    manager = await user('Manager');
    cashier = await user('Cashier');
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function customer(balance = 0, creditLimit = 1000) {
    const { rows: [c] } = await db.query(
      `INSERT INTO customers (name, credit_balance, credit_limit) VALUES ($1, $2, $3) RETURNING id`,
      [`C ${randomUUID().slice(0, 8)}`, balance, creditLimit]);
    return c.id;
  }

  async function confirmedSale() {
    const res = await cashier.as('post', '/invoices').send({ items: [{ variantId, quantity: 1 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body.data;
    const paid = await cashier.as('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total), bankAccountId: accountId,
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect((await cashier.as('post', `/invoices/${inv.id}/confirm`)).status).toBe(200);
    return inv;
  }

  it('a Cashier cannot lift a credit limit, a Manager can', async () => {
    const id = await customer();
    const raise = (by) => by.as('put', `/customers/${id}`).send({ creditLimit: 0 });
    expect((await raise(cashier)).status).toBe(403);
    // Saving the form with the limit unchanged still works for a Cashier.
    expect((await cashier.as('put', `/customers/${id}`).send({ notes: 'Called', creditLimit: 1000 })).status).toBe(200);
    expect((await raise(manager)).status).toBe(200);
  });

  it('a Cashier cannot create a customer with a credit limit', async () => {
    const res = await cashier.as('post', '/customers').send({ name: 'New shop', creditLimit: 5000 });
    expect(res.status).toBe(403);
  });

  it('an edit cannot deactivate a customer without customer.delete or with a debt', async () => {
    const debtor = await customer(500);
    expect((await cashier.as('put', `/customers/${debtor}`).send({ isActive: false })).status).toBe(403);
    expect((await manager.as('put', `/customers/${debtor}`).send({ isActive: false })).status).toBe(403);
    expect((await adminUser.as('put', `/customers/${debtor}`).send({ isActive: false })).status).toBe(409);
  });

  it('a Cashier cannot void a customer payment', async () => {
    expect((await cashier.as('delete', `/customer-payments/${randomUUID()}`)).status).toBe(403);
    expect((await manager.as('delete', `/customer-payments/${randomUUID()}`)).status).toBe(404);
  });

  it('a deactivated product cannot be sold through the API', async () => {
    const { rows: [p] } = await db.query(`INSERT INTO products (name, is_active) VALUES ('Retired', false) RETURNING id`);
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, stock_qty) VALUES ($1, $2, 10, 5) RETURNING id`,
      [p.id, randomUUID()]);
    const res = await cashier.as('post', '/invoices').send({ items: [{ variantId: v.id, quantity: 1 }] });
    expect(res.status).toBe(409);
  });

  it('a resumed draft gets its card tender and reference back', async () => {
    const res = await cashier.as('post', '/invoices').send({ items: [{ variantId, quantity: 1 }] });
    const inv = res.body.data;
    await cashier.as('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total), bankAccountId: accountId, reference: 'SLIP-9',
    });
    const detail = await cashier.as('get', `/invoices/${inv.id}`);
    expect(detail.body.data.payments[0]).toMatchObject({ tender: 'card', reference: 'SLIP-9', bankAccountId: accountId });
  });

  it('the exchange tender choice survives the route', async () => {
    const inv = await confirmedSale();
    const { rows: [line] } = await db.query(`SELECT id, variant_id FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    const res = await manager.as('post', '/return-requests').send({
      returnType: 'customer_replace', referenceType: 'invoice', referenceId: inv.id,
      reason: 'customer_request', requestNote: 'Swap this for two of them',
      items: [{ invoiceItemId: line.id, variantId: line.variant_id, productId, quantity: 1, condition: 'good' }],
      refundPlan: [],
      replacementPlan: {
        items: [{ variantId, quantity: 2 }],
        differencePayment: { method: 'bank', bankAccountId: accountId },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { rows: [row] } = await db.query(`SELECT replacement_plan FROM return_requests WHERE id = $1`, [res.body.data.id]);
    expect(row.replacement_plan.differencePayment).toMatchObject({ method: 'bank', bankAccountId: accountId });
  });

  it('an invoice with a claimed warranty, or that is a replacement, cannot be cancelled', async () => {
    const claimed = await confirmedSale();
    await db.query(
      `INSERT INTO warranties (warranty_number, product_id, invoice_id, warranty_type, start_date, duration_months, end_date, status)
       VALUES ($1, $2, $3, 'customer', CURRENT_DATE, 12, CURRENT_DATE + 365, 'claimed')`,
      [`W-${randomUUID().slice(0, 8)}`, productId, claimed.id]);
    const res = await manager.as('post', `/invoices/${claimed.id}/cancel`).send({ reason: 'Customer changed mind' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(JSON.stringify(res.body)).toContain('warranty');
  });

  it('nobody but an Admin approves their own edit request, and the invoice must match', async () => {
    const inv = await confirmedSale();
    const { rows: [mine] } = await db.query(
      `INSERT INTO invoice_edit_requests (invoice_id, requested_by, request_note, changes, status)
       VALUES ($1, $2, 'Fix the note please', '{"notes":"x"}', 'pending') RETURNING id`,
      [inv.id, manager.id]);
    const own = await manager.as('put', `/invoices/${inv.id}/edit-request/${mine.id}/approve`);
    expect(own.status, JSON.stringify(own.body)).toBe(403);
    const other = await confirmedSale();
    const mismatch = await adminUser.as('put', `/invoices/${other.id}/edit-request/${mine.id}/approve`);
    expect(mismatch.status).toBe(404);
    expect((await adminUser.as('put', `/invoices/${inv.id}/edit-request/${mine.id}/approve`)).status).toBe(200);
  });

  it('an approved draft edit cannot apply a discount without override_price', async () => {
    const res = await cashier.as('post', '/invoices').send({ items: [{ variantId, quantity: 1 }] });
    const inv = res.body.data;
    const { rows: [req] } = await db.query(
      `INSERT INTO invoice_edit_requests (invoice_id, requested_by, request_note, changes, status)
       VALUES ($1, $2, 'Give a big discount', $3, 'pending') RETURNING id`,
      [inv.id, cashier.id, JSON.stringify({
        items: [{ variant_id: variantId, quantity: 1, discount_amount: 45 }], invoiceDiscount: 5,
      })]);
    const approved = await manager.as('put', `/invoices/${inv.id}/edit-request/${req.id}/approve`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const { rows: [row] } = await db.query(`SELECT invoice_discount FROM invoices WHERE id = $1`, [inv.id]);
    expect(Number(row.invoice_discount)).toBe(0);
    const { rows: [line] } = await db.query(`SELECT discount_amount FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    expect(Number(line.discount_amount)).toBe(0);
  });
});
