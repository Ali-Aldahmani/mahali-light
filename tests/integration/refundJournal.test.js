/**
 * Refund journal / VAT report regression test.
 *
 * Reported directly against the live app: after creating an invoice and
 * requesting a full refund, the Dashboard's "Financial Snapshot" widget
 * showed Revenue 500 / Expenses 525 / Net Profit -25 instead of netting to
 * zero, and Finance > VAT Report kept showing AED 25 due on a sale that no
 * longer existed.
 *
 * Root cause: journalService.postRefundEntry debited account 5013
 * ("Refunds Given", an expense account) for the full refund instead of
 * reversing what postSaleEntry actually credited — Sales Revenue (4001)
 * and VAT Payable (2002). A refund never undid the original sale in the
 * ledger; it just added an unrelated expense on top of untouched revenue.
 *
 * financialReportService.getVATReport had the same class of bug
 * independently: it read straight from `invoices` and never subtracted
 * customer returns/refunds in the same period at all.
 *
 * This test drives the real HTTP route stack end to end (create invoice,
 * pay, confirm, request+approve a full refund) and then asserts the real
 * P&L and VAT report — which is what the Finance tab and Dashboard both
 * ultimately read — net back to zero for that invoice.
 *
 * Creates and drops its own database on an explicitly selected local test
 * server, mirroring tests/integration/invoiceIntegrity.test.js.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('refund reverses revenue + VAT in the journal on real PostgreSQL', () => {
  let db, auth, app, request, admin, financialReportService;
  let adminToken, adminId, productId, variantId, customerId;
  const database = `refund_journal_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  // The store's business day (Asia/Dubai) — what the app books sales under.
  // The UTC day differs between 00:00 and 04:00 Dubai time.
  const today = require('../../server/utils/dates').todayStoreDate();

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
    financialReportService = require('../../server/services/financialReportService');

    auth = require('../../server/middleware/auth');
    const { rows: seededAdmin } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = seededAdmin[0].id;
    adminToken = auth.signToken({ sub: adminId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [adminId, auth.hashToken(adminToken)],
    );

    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Cables') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('Test Wire', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    productId = prod.id;
    const { rows: [variant] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, 'SKU-REFUND-TEST', 'BC-REFUND-TEST', 100, 60, 50, true) RETURNING id`,
      [productId],
    );
    variantId = variant.id;
    const { rows: [customer] } = await db.query(`INSERT INTO customers (name) VALUES ('Test Customer') RETURNING id`);
    customerId = customer.id;

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('nets P&L revenue and VAT payable back to zero after a full refund', async () => {
    // 1. Create + confirm a 5-unit sale (500 taxable + 25 VAT = 525 total).
    const createRes = await request(app)
      .post('/invoices')
      .auth(adminToken, { type: 'bearer' })
      .send({ customerId, items: [{ variantId, quantity: 5 }] });
    expect(createRes.status).toBe(201);
    const invoiceId = createRes.body.data.id;

    const payRes = await request(app)
      .post(`/invoices/${invoiceId}/payments`)
      .auth(adminToken, { type: 'bearer' })
      .send({ idempotencyKey: randomUUID(), method: 'cash', amount: 525 });
    expect(payRes.status).toBe(201);

    const confirmRes = await request(app)
      .post(`/invoices/${invoiceId}/confirm`)
      .auth(adminToken, { type: 'bearer' })
      .send({});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.invoice.total).toBe(525);

    const { rows: [invoiceItem] } = await db.query(
      `SELECT id FROM invoice_items WHERE invoice_id = $1`,
      [invoiceId],
    );

    const before = await financialReportService.getProfitAndLoss({ startDate: today, endDate: today });
    expect(before.revenue.total).toBe(500);
    const vatBefore = await financialReportService.getVATReport({ startDate: today, endDate: today });
    expect(vatBefore.outputTax).toBe(25);

    // 2. Request + approve a full refund of all 5 units.
    const reqRes = await request(app)
      .post('/return-requests')
      .auth(adminToken, { type: 'bearer' })
      .send({
        returnType: 'customer_refund',
        referenceType: 'invoice',
        referenceId: invoiceId,
        customerId,
        reason: 'defective',
        requestNote: 'Full refund regression test note',
        items: [
          {
            invoiceItemId: invoiceItem.id,
            productId,
            variantId,
            quantity: 5,
            unitPrice: 100,
            condition: 'good',
          },
        ],
        refundPlan: [{ method: 'cash', amount: 525 }],
      });
    expect(reqRes.status).toBe(201);
    const requestId = reqRes.body.data.id;

    const approveRes = await request(app)
      .put(`/return-requests/${requestId}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .send({ notes: 'approved for regression test' });
    expect(approveRes.status).toBe(200);

    // 3. P&L and VAT report must both net back to zero for this invoice —
    // not show a phantom loss (revenue untouched, refund booked as an
    // unrelated expense) or continued VAT due on a fully-refunded sale.
    const after = await financialReportService.getProfitAndLoss({ startDate: today, endDate: today });
    expect(after.revenue.total).toBe(0);
    expect(after.netProfit).toBe(0);

    const vatAfter = await financialReportService.getVATReport({ startDate: today, endDate: today });
    expect(vatAfter.outputTax).toBe(0);
    expect(vatAfter.netPayable).toBe(0);

    // 4. Every journal entry this flow posted must itself balance
    // (debits == credits) — the general invariant the whole ledger relies
    // on, not just this test's specific before/after assertions.
    const { rows: unbalanced } = await db.query(`
      SELECT je.id
        FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id
       GROUP BY je.id
      HAVING SUM(jl.debit) <> SUM(jl.credit)
    `);
    expect(unbalanced).toHaveLength(0);
  });
});
