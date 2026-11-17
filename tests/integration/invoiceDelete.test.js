import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

// Deleting invoices (Admin/Manager): a confirmed sale is reversed first, so
// stock, drawer, bank, credit and the ledger are back where they started
// once the invoice is gone. Creates and drops its own database on an
// explicitly selected local test server.
describe.skipIf(!enabled)('invoice delete on real PostgreSQL', () => {
  let admin, db, invoices, payments, app, request, userId, uploads;
  const database = `invoice_delete_${randomUUID().replaceAll('-', '')}`;
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
    await require('../../server/services/cashService').openDrawer({ openingBalance: 0, employeeId: null });
    await db.query(`INSERT INTO financial_periods (name,period_type,start_date,end_date)
      SELECT 'Regression current year','yearly',date_trunc('year', CURRENT_DATE)::date,
        (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date
      WHERE NOT EXISTS (SELECT 1 FROM financial_periods WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)`);
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    invoices = require('../../server/services/invoiceService');
    payments = require('../../server/controllers/invoicePaymentsController');
    userId = (await db.query(`INSERT INTO users (username,password_hash) VALUES ('regression','unused') RETURNING id`)).rows[0].id;
    uploads = path.join(process.cwd(), 'tmp', database);
    process.env.UPLOADS_DIR = uploads;
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.post('/invoices/:id/payments', (req, _res, next) => { req.user = { id: userId }; next(); }, payments.create);
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    if (uploads) {
      const resolved = path.resolve(uploads);
      if (path.dirname(resolved) !== path.resolve(process.cwd(), 'tmp') || path.basename(resolved) !== database) {
        throw new Error('Test cleanup path is outside the isolated test directory');
      }
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  const REASON = 'Entered by mistake in testing';

  async function variant({ price = 100, cost = 40, stock = 20 } = {}) {
    const product = (await db.query(`INSERT INTO products (name) VALUES ('Regression item') RETURNING id`)).rows[0];
    return (await db.query(`INSERT INTO product_variants (product_id,sku,selling_price,cost_price,stock_qty)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [product.id, randomUUID(), price, cost, stock])).rows[0];
  }
  async function draft({ quantity = 1, price = 100, customerId = null } = {}) {
    const v = await variant({ price });
    const inv = (await db.query(`INSERT INTO invoices (invoice_number,customer_id,tax_rate)
      VALUES ($1,$2,0) RETURNING *`, [randomUUID(), customerId])).rows[0];
    await db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: v.id, quantity, unit_price: price }]);
      await invoices.recalculateAndPersistTotals(client, inv.id);
    });
    return { ...(await invoice(inv.id)), variant: v };
  }
  async function invoice(id) { return (await db.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0]; }
  async function stock(id) { return Number((await db.query('SELECT stock_qty FROM product_variants WHERE id=$1', [id])).rows[0].stock_qty); }
  async function cash() { return Number((await db.query('SELECT current_balance FROM cash_drawer LIMIT 1')).rows[0].current_balance); }
  async function pay(inv, amount, method = 'cash', extra = {}) {
    return request(app).post(`/invoices/${inv.id}/payments`).send({ amount, method, idempotencyKey: randomUUID(), ...extra });
  }
  async function net(id, code) {
    return Number((await db.query(`SELECT COALESCE(SUM(l.debit-l.credit),0) AS amount
      FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id
      JOIN chart_of_accounts a ON a.id=l.account_id WHERE e.reference_id=$1 AND a.code=$2`, [id, code])).rows[0].amount);
  }

  it('reverses a confirmed cash/bank/credit sale, then removes it', async () => {
    // NULL credit_limit = no limit (migration 056; 0 means no credit).
    const c = (await db.query(`INSERT INTO customers (name, credit_limit) VALUES ('Regression customer', NULL) RETURNING *`)).rows[0];
    const bank = (await db.query(`INSERT INTO bank_accounts (bank_name,account_name,is_default) VALUES ('Original','Test',true) RETURNING id`)).rows[0];
    const inv = await draft({ customerId: c.id });
    const cashBefore = await cash();
    expect((await pay(inv, 40)).status).toBe(201);
    expect((await pay(inv, 35, 'bank', { bankAccountId: bank.id })).status).toBe(201);
    expect((await pay(inv, 25, 'credit')).status).toBe(201);
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId });
    expect(await stock(inv.variant.id)).toBe(19);

    const deleted = await invoices.deleteInvoices({ invoiceIds: [inv.id], employeeId: userId, reason: REASON });

    expect(deleted).toEqual([expect.objectContaining({ id: inv.id, status: 'confirmed' })]);
    expect(await invoice(inv.id)).toBeUndefined();
    expect((await db.query('SELECT 1 FROM invoice_items WHERE invoice_id=$1', [inv.id])).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM invoice_payments WHERE invoice_id=$1', [inv.id])).rows).toHaveLength(0);
    // Everything the sale moved is back.
    expect(await stock(inv.variant.id)).toBe(20);
    expect(await cash()).toBe(cashBefore);
    expect(Number((await db.query('SELECT current_balance FROM bank_accounts WHERE id=$1', [bank.id])).rows[0].current_balance)).toBe(0);
    expect(Number((await db.query('SELECT credit_balance FROM customers WHERE id=$1', [c.id])).rows[0].credit_balance)).toBe(0);
    for (const code of ['1001', '1002', '1003', '4001', '5001', '1004']) expect(await net(inv.id, code)).toBe(0);
    // What was deleted, and why, is kept.
    const log = (await db.query(
      `SELECT old_value, notes, performed_by FROM activity_log WHERE action='invoice.deleted' AND entity_id=$1`, [inv.id],
    )).rows[0];
    expect(log.performed_by).toBe(userId);
    expect(log.notes).toBe(`${inv.invoice_number}: ${REASON}`);
    expect(log.old_value.invoice.invoice_number).toBe(inv.invoice_number);
    expect(log.old_value.items).toHaveLength(1);
    expect(log.old_value.payments).toHaveLength(3);
  });

  it('removes a draft without touching stock or cash', async () => {
    const inv = await draft();
    const cashBefore = await cash();
    await invoices.deleteInvoices({ invoiceIds: [inv.id], employeeId: userId, reason: REASON });
    expect(await invoice(inv.id)).toBeUndefined();
    expect(await stock(inv.variant.id)).toBe(20);
    expect(await cash()).toBe(cashBefore);
  });

  it('removes an already-cancelled sale without reversing it twice', async () => {
    const inv = await draft();
    expect((await pay(inv, 100)).status).toBe(201);
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId });
    const cashBefore = await cash();
    await invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId, reason: 'Test cancellation' });
    expect(await cash()).toBe(cashBefore - 100);
    await invoices.deleteInvoices({ invoiceIds: [inv.id], employeeId: userId, reason: REASON });
    expect(await invoice(inv.id)).toBeUndefined();
    expect(await stock(inv.variant.id)).toBe(20);
    expect(await cash()).toBe(cashBefore - 100);
  });

  it('deletes all of a bulk selection or none', async () => {
    const ok = await draft();
    expect((await pay(ok, 100)).status).toBe(201);
    await invoices.confirmInvoice({ invoiceId: ok.id, employeeId: userId });
    const blocked = await draft();
    expect((await pay(blocked, 100)).status).toBe(201);
    await invoices.confirmInvoice({ invoiceId: blocked.id, employeeId: userId });
    await db.query(`UPDATE invoices SET has_return = true WHERE id = $1`, [blocked.id]);
    const cashBefore = await cash();

    await expect(invoices.deleteInvoices({ invoiceIds: [ok.id, blocked.id], employeeId: userId, reason: REASON }))
      .rejects.toMatchObject({ message: `Cannot delete ${blocked.invoice_number}: It has a recorded return.` });

    expect(await invoice(ok.id)).toBeDefined();
    expect((await invoice(ok.id)).status).toBe('confirmed');
    expect(await stock(ok.variant.id)).toBe(19);
    expect(await cash()).toBe(cashBefore);
  });

  it('keeps card fees the provider charged after the invoice is gone', async () => {
    const inv = await draft();
    const fee = (await db.query(`INSERT INTO payment_fees
        (invoice_id, provider_name, kind, source_type, source_id, base_amount, fee_amount, amount, fee_date)
      VALUES ($1, 'Test card', 'charge', 'invoice', $1, 100, 2.5, 2.5, CURRENT_DATE) RETURNING id`, [inv.id])).rows[0];
    await invoices.deleteInvoices({ invoiceIds: [inv.id], employeeId: userId, reason: REASON });
    const row = (await db.query('SELECT invoice_id, amount FROM payment_fees WHERE id=$1', [fee.id])).rows[0];
    expect(row.invoice_id).toBeNull();
    expect(Number(row.amount)).toBe(2.5);
  });

  it('needs a reason', async () => {
    const inv = await draft();
    await expect(invoices.deleteInvoices({ invoiceIds: [inv.id], employeeId: userId, reason: ' ' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await invoice(inv.id)).toBeDefined();
  });
});
