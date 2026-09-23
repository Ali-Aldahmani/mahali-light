/**
 * Purchase VAT regression test.
 *
 * Receiving a PO posted DR Inventory / CR Payables at the net value only,
 * while supplier payments are allowed up to the VAT-inclusive total — so
 * payables went negative by the VAT on every fully paid PO — and input VAT
 * was never booked anywhere. The VAT report read purchase_orders.vat_amount,
 * a column nothing ever wrote, so input tax was always 0 and VAT payable
 * was overstated by all purchase VAT. Receipts now book input VAT (2002)
 * proportionally, supplier returns reverse it, and the VAT report reads the
 * ledger.
 *
 * Drives the real purchase-order routes. Creates and drops its own database.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('purchase VAT on real PostgreSQL', () => {
  let db, auth, app, request, admin, financialReportService, returnService, dates;
  let adminToken, adminId, productId, supplierId;
  const database = `purchase_vat_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const call = (method, path, body) =>
    request(app)[method](path).auth(adminToken, { type: 'bearer' }).send(body || {});

  async function newVariant(sku, cost) {
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, $2, $2, 200, $3, 0, true) RETURNING id`,
      [productId, sku, cost],
    );
    return v.id;
  }
  async function confirmedPo(variantId, quantity, cost) {
    const created = await call('post', '/purchase-orders', {
      supplierId, items: [{ productId, variantId, quantity, costPricePerUnit: cost }],
    });
    expect(created.status).toBe(201);
    const poId = created.body.data.id;
    expect((await call('post', `/purchase-orders/${poId}/confirm`)).status).toBe(200);
    const { rows: [item] } = await db.query(
      `SELECT id FROM purchase_order_items WHERE purchase_order_id = $1`, [poId]);
    return { poId, itemId: item.id };
  }
  async function receive(poId, itemId, quantityReceived) {
    const res = await call('post', `/purchase-orders/${poId}/receive`, { items: [{ id: itemId, quantityReceived }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  // Net debit (debit − credit) per account code across a PO's receipts.
  async function receiptNet(poId) {
    const { rows } = await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit)::float8 AS net
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         JOIN chart_of_accounts a ON a.id = jl.account_id
        WHERE je.reference_type = 'purchase_order' AND je.reference_id = $1
        GROUP BY a.code`,
      [poId],
    );
    return Object.fromEntries(rows.map((r) => [r.code, Math.round(r.net * 100) / 100]));
  }
  // Payables still owed on a PO = receipt credits − payment debits.
  async function payablesOwed(poId) {
    const { rows: [r] } = await db.query(
      `SELECT COALESCE(SUM(jl.credit - jl.debit), 0)::float8 AS owed
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         JOIN chart_of_accounts a ON a.id = jl.account_id AND a.code = '2001'
        WHERE (je.reference_type = 'purchase_order' AND je.reference_id = $1)
           OR (je.reference_type = 'supplier_payment' AND je.reference_id IN (
                 SELECT id FROM supplier_payments WHERE purchase_order_id = $1))`,
      [poId],
    );
    return Math.round(r.owed * 100) / 100;
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
    await db.query(`UPDATE app_settings SET vat_enabled = true, vat_rate = 5`);
    auth = require('../../server/middleware/auth');
    financialReportService = require('../../server/services/financialReportService');
    returnService = require('../../server/services/returnService');
    dates = require('../../server/utils/dates');

    const { rows: [seededAdmin] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = seededAdmin.id;
    adminToken = auth.signToken({ sub: adminId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [adminId, auth.hashToken(adminToken)],
    );
    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Switches') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('Wall Switch', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    productId = prod.id;
    const { rows: [supplier] } = await db.query(`INSERT INTO suppliers (name) VALUES ('VAT Supplier') RETURNING id`);
    supplierId = supplier.id;
    await db.query(
      `INSERT INTO bank_accounts (account_name, bank_name, is_active, is_default, current_balance)
       VALUES ('Operating', 'Test Bank', true, true, 10000)`,
    );

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  let fullPo;

  it('books input VAT on each partial receipt and payables at the gross amount', async () => {
    const v = await newVariant('SKU-VAT-1', 100);
    fullPo = await confirmedPo(v, 3, 100); // 300 + 15 VAT = 315

    await receive(fullPo.poId, fullPo.itemId, 1);
    expect(await receiptNet(fullPo.poId)).toEqual({ 1004: 100, 2002: 5, 2001: -105 });

    await receive(fullPo.poId, fullPo.itemId, 2);
    expect(await receiptNet(fullPo.poId)).toEqual({ 1004: 300, 2002: 15, 2001: -315 });
    const { rows: [po] } = await db.query(`SELECT tax_amount, vat_amount FROM purchase_orders WHERE id = $1`, [fullPo.poId]);
    expect(Number(po.vat_amount)).toBe(Number(po.tax_amount));
  });

  it('paying the PO in full clears its payables (no longer driven negative)', async () => {
    const res = await call('post', `/purchase-orders/${fullPo.poId}/payments`, { amount: 315, paymentMethod: 'bank_transfer' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await payablesOwed(fullPo.poId)).toBe(0); // was −15 before the fix
  });

  it('partial receipts sum to exactly the PO VAT despite rounding', async () => {
    const v = await newVariant('SKU-VAT-2', 33.33);
    const { poId, itemId } = await confirmedPo(v, 3, 33.33); // 99.99, VAT 5.00
    for (let i = 0; i < 3; i += 1) await receive(poId, itemId, 1);
    const { rows: [po] } = await db.query(`SELECT tax_amount FROM purchase_orders WHERE id = $1`, [poId]);
    expect((await receiptNet(poId))[2002]).toBe(Number(po.tax_amount));
  });

  it('a supplier return against the PO reverses its input VAT', async () => {
    const v = await newVariant('SKU-VAT-3', 100);
    const { poId, itemId } = await confirmedPo(v, 2, 100); // 200 + 10 VAT
    await receive(poId, itemId, 2);

    const request1 = await returnService.createReturnRequest({
      returnType: 'supplier_return', referenceType: 'purchase_order', referenceId: poId, supplierId,
      reason: 'defective', requestNote: 'Unit arrived cracked, sending back.',
      items: [{ variantId: v, quantity: 1, condition: 'defective' }], requestedBy: adminId,
    });
    const requestId = request1.id || request1.request?.id;
    const executed = await returnService.approveAndExecute({ requestId, managerId: adminId });
    const orderId = executed.order?.id || executed.orderId || executed.returnOrder?.id;

    const { rows } = await db.query(
      `SELECT a.code, SUM(jl.debit - jl.credit)::float8 AS net
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_entry_id = je.id
         JOIN chart_of_accounts a ON a.id = jl.account_id
        WHERE je.reference_type = 'return_order' AND je.reference_id = $1
        GROUP BY a.code`,
      [orderId],
    );
    const net = Object.fromEntries(rows.map((r) => [r.code, Math.round(r.net * 100) / 100]));
    expect(net).toEqual({ 2001: 105, 1004: -100, 2002: -5 });
  });

  it('the VAT report reads input tax from the ledger', async () => {
    const today = dates.todayStoreDate();
    const vat = await financialReportService.getVATReport({ startDate: today, endDate: today });
    // Receipts: 15 + 5.00 + 10 input VAT, minus 5 reversed by the supplier return.
    expect(vat.inputTax).toBe(25);
    // Net purchases: 300 + 99.99 + 200 received, minus 100 returned.
    expect(vat.netPurchases).toBe(499.99);
  });
});
