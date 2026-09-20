import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

// Creates and drops its own database on an explicitly selected local test
// server. No production credentials or database names are loaded from .env.
describe.skipIf(!enabled)('invoice integrity on real PostgreSQL', () => {
  let admin, db, invoices, returns, payments, app, request, userId, uploads;
  const database = `invoice_regression_${randomUUID().replaceAll('-', '')}`;
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
    // PDF rendering is outside these transaction tests. All financial, stock,
    // authentication and locking code below uses the production implementations.
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    invoices = require('../../server/services/invoiceService');
    returns = require('../../server/services/returnService');
    payments = require('../../server/controllers/invoicePaymentsController');
    userId = (await db.query(`INSERT INTO users (username,password_hash) VALUES ('regression','unused') RETURNING id`)).rows[0].id;
    uploads = path.join(process.cwd(), 'tmp', database);
    process.env.UPLOADS_DIR = uploads;
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.post('/invoices/:id/payments', (req, _res, next) => { req.user = { id: userId }; next(); }, payments.create);
    app.use('/files', require('../../server/routes/files').createFilesRouter());
    app.use((err, _req, res, _next) => res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
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

  async function variant({ price = 100, cost = 40, stock = 20 } = {}) {
    const product = (await db.query(`INSERT INTO products (name) VALUES ('Regression item') RETURNING id`)).rows[0];
    return (await db.query(`INSERT INTO product_variants (product_id,sku,selling_price,cost_price,stock_qty)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`, [product.id, randomUUID(), price, cost, stock])).rows[0];
  }
  async function customer(limit = 0) {
    return (await db.query(`INSERT INTO customers (name,credit_limit) VALUES ('Regression customer',$1) RETURNING *`, [limit])).rows[0];
  }
  async function draft({ v, quantity = 1, price = 100, discount = 0, invoiceDiscount = 0, taxRate = 0, customerId = null } = {}) {
    v ||= await variant({ price });
    const inv = (await db.query(`INSERT INTO invoices (invoice_number,customer_id,tax_rate,invoice_discount)
      VALUES ($1,$2,$3,$4) RETURNING *`, [randomUUID(), customerId, taxRate, invoiceDiscount])).rows[0];
    await db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: v.id, quantity, unit_price: price, discount_amount: discount }]);
      await invoices.recalculateAndPersistTotals(client, inv.id);
    });
    return { ...await invoice(inv.id), variant: v };
  }
  async function invoice(id) { return (await db.query('SELECT * FROM invoices WHERE id=$1', [id])).rows[0]; }
  async function stock(id) { return Number((await db.query('SELECT stock_qty FROM product_variants WHERE id=$1', [id])).rows[0].stock_qty); }
  async function cash() { return Number((await db.query('SELECT current_balance FROM cash_drawer LIMIT 1')).rows[0].current_balance); }
  async function pay(inv, amount, method = 'cash', key = randomUUID(), extra = {}) {
    return request(app).post(`/invoices/${inv.id}/payments`).send({ amount, method, idempotencyKey: key, ...extra });
  }
  async function sale(options = {}, method = 'cash') {
    const inv = await draft(options);
    if (Number(inv.total)) expect((await pay(inv, Number(inv.total), method)).status).toBe(201);
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId });
    return { ...await invoice(inv.id), variant: inv.variant };
  }
  async function net(id, code) {
    return Number((await db.query(`SELECT COALESCE(SUM(l.debit-l.credit),0) AS amount
      FROM journal_lines l JOIN journal_entries e ON e.id=l.journal_entry_id
      JOIN chart_of_accounts a ON a.id=l.account_id WHERE e.reference_id=$1 AND a.code=$2`, [id, code])).rows[0].amount);
  }
  async function edit(inv, changes) {
    const req = (await db.query(`INSERT INTO invoice_edit_requests (invoice_id,requested_by,request_note,changes)
      VALUES ($1,$2,'Regression correction',$3) RETURNING id`, [inv.id, userId, JSON.stringify(changes)])).rows[0];
    return invoices.applyEditRequest({ requestId: req.id, managerId: userId });
  }
  async function returnRequest(inv, { quantity = 1, plan = [{ method: 'cash', amount: Number(inv.total) }], replacement = null } = {}) {
    const line = (await db.query('SELECT * FROM invoice_items WHERE invoice_id=$1', [inv.id])).rows[0];
    return returns.createReturnRequest({
      returnType: replacement ? 'customer_replace' : 'customer_refund', referenceType: 'invoice', referenceId: inv.id,
      reason: 'customer_request', requestNote: 'Regression return request', requestedBy: userId,
      items: [{ invoiceItemId: line.id, quantity, condition: 'good' }], refundPlan: plan, replacementPlan: replacement,
    });
  }
  const approve = (r) => returns.approveAndExecute({ requestId: r.request.id, managerId: userId });

  it('F1 reverses mixed cash/bank/credit to the original account exactly once', async () => {
    const c = await customer();
    const bank = (await db.query(`INSERT INTO bank_accounts (bank_name,account_name,is_default) VALUES ('Original','Test',true) RETURNING id`)).rows[0];
    const inv = await draft({ customerId: c.id });
    const before = await cash();
    expect((await pay(inv, 40)).status).toBe(201);
    expect((await pay(inv, 35, 'bank')).status).toBe(201);
    expect((await pay(inv, 25, 'credit')).status).toBe(201);
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId });
    await db.query('UPDATE bank_accounts SET is_default=false');
    const changed = (await db.query(`INSERT INTO bank_accounts (bank_name,account_name,is_default) VALUES ('New default','Test',true) RETURNING id`)).rows[0];
    await invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId });
    expect(await cash()).toBe(before);
    expect(await stock(inv.variant.id)).toBe(20);
    for (const id of [bank.id, changed.id]) expect(Number((await db.query('SELECT current_balance FROM bank_accounts WHERE id=$1', [id])).rows[0].current_balance)).toBe(0);
    expect(Number((await db.query('SELECT credit_balance FROM customers WHERE id=$1', [c.id])).rows[0].credit_balance)).toBe(0);
    for (const code of ['1001','1002','1003','4001','5001','1004']) expect(await net(inv.id, code)).toBe(0);
    await expect(invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId })).rejects.toMatchObject({ code: 'BIZ_INVALID_STATE' });
    expect(await cash()).toBe(before);
  });

  it('F1 rolls back stock and treasury when the journal period is closed', async () => {
    const inv = await sale();
    const before = await cash();
    await db.query("UPDATE financial_periods SET status='closed'");
    try {
      await expect(invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId })).rejects.toMatchObject({ code: 'BIZ_PERIOD_CLOSED' });
      expect((await invoice(inv.id)).status).toBe('confirmed');
      expect(await stock(inv.variant.id)).toBe(19);
      expect(await cash()).toBe(before);
    } finally { await db.query("UPDATE financial_periods SET status='open'"); }
  });

  it('F1 refuses to clamp collected customer credit while reversing its journal', async () => {
    const c = await customer();
    const inv = await sale({ customerId: c.id }, 'credit');
    await require('../../server/services/customerService').collectPayment({
      customerId: c.id, invoiceId: inv.id, amount: 100, method: 'cash', employeeId: userId,
    });
    const before = await cash();
    await expect(invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId })).rejects.toMatchObject({ code: 'BIZ_INVALID_STATE' });
    expect(await stock(inv.variant.id)).toBe(19);
    expect((await invoice(inv.id)).status).toBe('confirmed');
    expect(await cash()).toBe(before);
    expect(await net(inv.id, '1003')).toBe(100);
  });

  it('F2 concurrent retries create one payment and reject key reuse with different details', async () => {
    const inv = await draft();
    const results = await Promise.all([pay(inv, 40, 'cash', 'same'), pay(inv, 40, 'cash', 'same')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.data.id).toBe(results[1].body.data.id);
    expect((await pay(inv, 41, 'cash', 'same')).status).toBe(409);
    expect((await invoice(inv.id)).amount_paid).toBe('40.00');
  });

  it('F2 concurrent distinct payments cannot exceed a draft balance', async () => {
    const inv = await draft();
    const results = await Promise.all([pay(inv, 60), pay(inv, 60)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await invoice(inv.id)).amount_paid).toBe('60.00');
    expect((await pay(inv, 0.001)).status).toBe(400);
    expect((await request(app).post(`/invoices/${inv.id}/payments`).send({ method: 'cash', amount: 1 })).status).toBe(400);
  });

  it('F2 replays after confirmation without reposting, rejects new payments and legacy overpayment', async () => {
    const inv = await draft();
    await pay(inv, 100, 'cash', 'stable');
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId });
    const before = await cash();
    expect((await pay(inv, 100, 'cash', 'stable')).status).toBe(200);
    expect((await pay(inv, 1)).status).toBe(409);
    expect(await cash()).toBe(before);
    const legacy = await draft();
    await db.query(`INSERT INTO invoice_payments (invoice_id,method,amount) VALUES ($1,'cash',101)`, [legacy.id]);
    await expect(invoices.confirmInvoice({ invoiceId: legacy.id, employeeId: userId })).rejects.toMatchObject({ code: 'BIZ_PAYMENT_EXCEEDS_BALANCE' });
    expect(await stock(legacy.variant.id)).toBe(20);
  });

  it('F3/F4 persists new variants, reconciles COGS on repeated equal-total edits, then cancels cleanly', async () => {
    const before = await cash();
    const inv = await sale();
    const v = await variant({ cost: 65 });
    await edit(inv, { items: [{ variant_id: inv.variant.id, quantity: 0 }, { variant_id: v.id, quantity: 1, unit_price: 100 }] });
    expect(await stock(inv.variant.id)).toBe(20);
    expect(await stock(v.id)).toBe(19);
    expect((await db.query('SELECT variant_id FROM invoice_items WHERE invoice_id=$1', [inv.id])).rows).toEqual([{ variant_id: v.id }]);
    expect(await net(inv.id, '5001')).toBe(65);
    expect(await net(inv.id, '4001')).toBe(-100);
    await edit(inv, { items: [{ variant_id: v.id, quantity: 2, unit_price: 50 }] });
    expect(await net(inv.id, '5001')).toBe(130);
    expect(await cash()).toBe(before + 100);
    await invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId });
    expect(await stock(v.id)).toBe(20);
    expect(await net(inv.id, '5001')).toBe(0);
    expect(await net(inv.id, '4001')).toBe(0);
    expect(await cash()).toBe(before);
  });

  it('F3 rejects unsettled total changes and rolls back item/stock/history writes', async () => {
    const inv = await sale();
    await expect(edit(inv, { items: [{ variant_id: inv.variant.id, quantity: 2 }] })).rejects.toMatchObject({ code: 'BIZ_INVOICE_LOCKED' });
    await expect(edit(inv, { invoiceDiscount: 1 })).rejects.toMatchObject({ code: 'BIZ_PAYMENT_EXCEEDS_BALANCE' });
    expect(await stock(inv.variant.id)).toBe(19);
    expect((await invoice(inv.id)).total).toBe('100.00');
    expect(await net(inv.id, '5001')).toBe(40);
  });

  it.each([120, 100, 80])('F5 replacement priced %s posts the correct cash delta and sale/COGS journal', async (price) => {
    const inv = await sale();
    const before = await cash();
    const v = await variant({ price, cost: 30 });
    const r = await returnRequest(inv, { plan: price < 100 ? [{ method: 'cash', amount: 100-price }] : null,
      replacement: { items: [{ variantId: v.id, quantity: 1, unitPrice: price }], priceDifference: 999, differenceDirection: 'customer_pays' } });
    const result = await approve(r);
    expect(await cash()).toBe(before + price - 100);
    expect(await stock(v.id)).toBe(19);
    expect(await stock(inv.variant.id)).toBe(20);
    const newId = result.order.replacement_invoice_id;
    expect(await net(newId, '1001')).toBe(Math.max(0, price - 100));
    expect(await net(newId, '4001')).toBe(price > 100 ? 100 - price : 0);
    expect(await net(newId, '5001')).toBe(30);
    expect(await net(inv.id, '5001') + await net(result.order.id, '5001') + await net(newId, '5001')).toBe(30);
    const replacement = await invoice(newId);
    expect(Number(replacement.total)).toBe(Math.max(0, price - 100));
    expect(Number(replacement.subtotal) - Number(replacement.discount_amount)).toBe(Number(replacement.taxable_amount));
  });

  it('F6 partial returns include line/invoice discounts and tax without exceeding the paid total', async () => {
    const inv = await sale({ quantity: 3, price: 10, discount: 3, invoiceDiscount: 2, taxRate: 5 });
    expect(Number(inv.total)).toBe(26.25);
    const before = await cash();
    for (let i = 0; i < 3; i++) {
      const r = await returnRequest(inv, { quantity: 1, plan: [{ method: 'cash', amount: 8.75 }] });
      expect(r.totalValue).toBe(8.75);
      await approve(r);
    }
    expect(await cash()).toBe(before - 26.25);
    await expect(returnRequest(inv)).rejects.toMatchObject({ code: 'BIZ_RETURN_QTY_EXCEEDED' });
  });

  it('F7 simultaneous credit sales serialize the shared credit limit', async () => {
    const c = await customer(100);
    const a = await draft({ price: 75, customerId: c.id });
    const b = await draft({ price: 75, customerId: c.id });
    await pay(a, 75, 'credit'); await pay(b, 75, 'credit');
    const result = await Promise.allSettled([a, b].map((inv) => invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId })));
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.find((r) => r.status === 'rejected').reason.code).toBe('BIZ_CREDIT_LIMIT_EXCEEDED');
    expect(Number((await db.query('SELECT credit_balance FROM customers WHERE id=$1', [c.id])).rows[0].credit_balance)).toBe(75);
  });

  it('F6 cancelled penny reservations do not prevent refunding the remaining paid cents', async () => {
    const inv = await sale({ quantity: 3, price: 1, invoiceDiscount: 2 });
    const first = await returnRequest(inv, { quantity: 1, plan: [{ method: 'cash', amount: 0.33 }] });
    const second = await returnRequest(inv, { quantity: 1, plan: [{ method: 'cash', amount: 0.34 }] });
    await returns.cancelReturnRequest({ requestId: first.request.id, userId });
    await approve(second);
    const third = await returnRequest(inv, { quantity: 1, plan: [{ method: 'cash', amount: 0.33 }] });
    await approve(third);
    const last = await returnRequest(inv, { quantity: 1, plan: [{ method: 'cash', amount: 0.33 }] });
    await approve(last);
    const refunded = (await db.query('SELECT SUM(refund_total) AS amount FROM return_orders WHERE original_invoice_id=$1', [inv.id])).rows[0];
    expect(Number(refunded.amount)).toBe(1);
  });

  it('F8 rejects duplicate lines and returns on draft invoices', async () => {
    const draftInv = await draft();
    await expect(returnRequest(draftInv)).rejects.toMatchObject({ code: 'BIZ_INVALID_STATE' });
    const inv = await sale();
    const line = (await db.query('SELECT id FROM invoice_items WHERE invoice_id=$1', [inv.id])).rows[0];
    await expect(returns.createReturnRequest({ returnType: 'customer_refund', referenceId: inv.id,
      reason: 'customer_request', requestNote: 'Duplicate return lines', requestedBy: userId,
      items: [1, 2].map(() => ({ invoiceItemId: line.id, quantity: 1, condition: 'good' })),
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('F9 rejects historical undiscounted requests at approval', async () => {
    const inv = await sale({ discount: 20 });
    const r = await returnRequest(inv);
    await db.query('UPDATE return_request_items SET total_value=100 WHERE return_request_id=$1', [r.request.id]);
    await db.query(`UPDATE return_requests SET refund_plan='[{"method":"cash","amount":100}]' WHERE id=$1`, [r.request.id]);
    await expect(approve(r)).rejects.toMatchObject({ code: 'BIZ_REFUND_PLAN_MISMATCH' });
    expect(await stock(inv.variant.id)).toBe(19);
  });

  it('F8 simultaneous return requests reserve the final unit only once', async () => {
    const inv = await sale();
    const results = await Promise.allSettled([returnRequest(inv), returnRequest(inv)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('BIZ_RETURN_QTY_EXCEEDED');
    await expect(invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId })).rejects.toMatchObject({ code: 'BIZ_INVOICE_LOCKED' });
    await expect(edit(inv, { items: [{ variant_id: inv.variant.id, quantity: 1, unit_price: 100 }] })).rejects.toMatchObject({ code: 'BIZ_INVOICE_LOCKED' });
  });

  it('F9 refuses empty or corrupted refund plans atomically', async () => {
    const inv = await sale();
    const r = await returnRequest(inv, { plan: [] });
    const before = await cash();
    await expect(approve(r)).rejects.toMatchObject({ code: 'BIZ_REFUND_PLAN_MISMATCH' });
    await db.query(`UPDATE return_requests SET refund_plan='[{"method":"cash","amount":101}]' WHERE id=$1`, [r.request.id]);
    await expect(approve(r)).rejects.toMatchObject({ code: 'BIZ_REFUND_PLAN_MISMATCH' });
    expect(await cash()).toBe(before);
    expect(await stock(inv.variant.id)).toBe(19);
    expect((await db.query('SELECT id FROM return_orders WHERE return_request_id=$1', [r.request.id])).rows).toHaveLength(0);
  });

  it('credit refunds reduce customer debt and receivable together', async () => {
    const c = await customer();
    const inv = await sale({ customerId: c.id }, 'credit');
    const r = await returnRequest(inv, { plan: [{ method: 'credit', amount: 100 }] });
    const result = await approve(r);
    expect(Number((await db.query('SELECT credit_balance FROM customers WHERE id=$1', [c.id])).rows[0].credit_balance)).toBe(0);
    expect(await net(result.order.id, '1003')).toBe(-100);
  });

  it('F10 blocks anonymous private files, enforces permissions, and keeps product images public', async () => {
    const id = randomUUID();
    for (const [rel, content] of [[`pdfs/invoices/private.pdf`, 'private TRN'], [`receipts/bills/${id}/receipt.pdf`, 'private receipt'], [`products/${id}/123.webp`, 'product']]) {
      const target = path.join(uploads, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
    }
    expect((await request(app).get('/files/pdfs/invoices/private.pdf')).status).toBe(401);
    expect((await request(app).get(`/files/receipts/bills/${id}/receipt.pdf`)).status).toBe(401);
    expect((await request(app).get(`/files/products/${id}/123.webp`)).status).toBe(200);
    const auth = require('../../server/middleware/auth');
    const token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id,pc_identifier,token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);
    expect((await request(app).get(`/files/receipts/bills/${id}/receipt.pdf`).auth(token, { type: 'bearer' })).status).toBe(403);
    const permission = (await db.query(`INSERT INTO permissions (key,label,module) VALUES ('bills.view','Bills','bills') ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label RETURNING id`)).rows[0];
    await db.query(`INSERT INTO user_permissions (user_id,permission_id,granted) VALUES ($1,$2,true)`, [userId, permission.id]);
    const allowed = await request(app).get(`/files/receipts/bills/${id}/receipt.pdf`).auth(token, { type: 'bearer' });
    expect(allowed.status).toBe(200);
    expect(allowed.headers['cache-control']).toBe('private, no-store');
    expect((await request(app).get('/files/pdfs/invoices/private.pdf').auth(token, { type: 'bearer' })).status).toBe(404);
    expect((await request(app).get('/files/products/%2e%2e%2fpdfs%2finvoices%2fprivate.pdf')).status).not.toBe(200);
  });

  it('CRIT-01 ignores a client-supplied unit price without invoice.override_price, honours it with the flag', async () => {
    const v = await variant({ price: 100 });
    const inv = (await db.query(`INSERT INTO invoices (invoice_number,tax_rate,invoice_discount)
      VALUES ($1,0,0) RETURNING *`, [randomUUID()])).rows[0];

    // Default caller (no allowPriceOverride) — a fabricated low price must
    // be ignored in favour of the product's real selling_price, no matter
    // what the client sent. This is the actual server-side fix for CRIT-01.
    await db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: v.id, quantity: 1, unit_price: 0.01 }]);
    });
    let item = (await db.query('SELECT unit_price FROM invoice_items WHERE invoice_id=$1', [inv.id])).rows[0];
    expect(Number(item.unit_price)).toBe(100);

    // A caller the controller has verified holds invoice.override_price
    // (passed through as allowPriceOverride: true) can still set a
    // deliberate custom price — the elevated/edit-approve path this audit
    // found already relies on, e.g. applyEditRequest.
    await db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: v.id, quantity: 1, unit_price: 75 }], { allowPriceOverride: true });
    });
    item = (await db.query('SELECT unit_price FROM invoice_items WHERE invoice_id=$1', [inv.id])).rows[0];
    expect(Number(item.unit_price)).toBe(75);
  });
});
