/**
 * SQL that Postgres rejects at analysis time (every call → 500).
 *
 * A sweep that PREPAREd every SQL literal under server/ against a migrated
 * database found statements that could never run:
 *   - warranty claim resolve: $1 assigned to a varchar column AND compared to
 *     text literals → 42P08 "inconsistent types deduced for parameter $1";
 *   - period-close checklist and global search: return_requests.created_at
 *     (the column is requested_at) → 42703;
 *   - purchase-order PDF: suppliers.trn_number (no such column) → 42703.
 * A second pass with EXPLAIN (GENERIC_PLAN) — which also plans — found
 * SELECT … LEFT JOIN … FOR UPDATE, rejected by the planner (0A000) in:
 *   - opening a warranty claim, approving/rejecting leave, reviewing an
 *     attendance correction, paying a scheduled bill.
 * Each is driven through its real route here, plus runtime checks of the
 * dynamically assembled queries the static sweep could only approximate,
 * and the stale-draft sweep (whose UPDATE is typed correctly — Postgres
 * analyses WHERE before SET — but had no test).
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('SQL statements Postgres used to reject, on real PostgreSQL', () => {
  let db, auth, app, request, admin;
  let adminToken, adminId, productId, variantId, customerId, supplierId, employeeId;
  const database = `sql_param_typing_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const call = (method, path, body) =>
    request(app)[method](path).auth(adminToken, { type: 'bearer' }).send(body || {});
  const expectOk = (res, status = 200) => expect(res.status, JSON.stringify(res.body)).toBe(status);

  let warrantySeq = 0;
  async function openClaim() {
    warrantySeq += 1;
    const { rows: [w] } = await db.query(
      `INSERT INTO warranties (warranty_number, product_id, variant_id, customer_id,
                               start_date, end_date, duration_months, status)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + 365, 12, 'active') RETURNING id`,
      [`WTY-TEST-${warrantySeq}`, productId, variantId, customerId],
    );
    const res = await call('post', '/warranty-claims', { warrantyId: w.id, issueDescription: 'Stopped working' });
    expectOk(res, 201);
    return res.body.data.id;
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

    const { rows: [seededAdmin] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = seededAdmin.id;
    adminToken = auth.signToken({ sub: adminId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [adminId, auth.hashToken(adminToken)],
    );
    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Fans') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('Ceiling Fan', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    productId = prod.id;
    const { rows: [variant] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, 'SKU-FAN', 'BC-FAN', 300, 180, 10, true) RETURNING id`,
      [productId],
    );
    variantId = variant.id;
    const { rows: [customer] } = await db.query(`INSERT INTO customers (name, phone) VALUES ('Fan Buyer', '0501112222') RETURNING id`);
    customerId = customer.id;
    const { rows: [supplier] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Fan Supplier') RETURNING id`);
    supplierId = supplier.id;
    const { rows: [employee] } = await db.query(
      `INSERT INTO employees (name, is_active) VALUES ('Staff Member', true) RETURNING id`,
    );
    employeeId = employee.id;
    await db.query(
      `INSERT INTO bank_accounts (account_name, bank_name, is_active, is_default, current_balance)
       VALUES ('Operating', 'Test Bank', true, true, 10000)`,
    );

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/warranty-claims', require('../../server/routes/warrantyClaims'));
    app.use('/finance', require('../../server/routes/finance'));
    app.use('/search', require('../../server/routes/search'));
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use('/holidays', require('../../server/routes/holidays'));
    app.use('/customers', require('../../server/routes/customers'));
    app.use('/suppliers', require('../../server/routes/suppliers'));
    app.use('/leaves', require('../../server/routes/leaves'));
    app.use('/attendance', require('../../server/routes/attendance'));
    app.use('/bills', require('../../server/routes/bills'));
    app.use('/bill-payments', require('../../server/routes/billPayments'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  // --- warranty claim resolution (42P08) ------------------------------------
  it.each(['repaired', 'rejected'])('resolves a warranty claim as %s', async (resolution) => {
    const claimId = await openClaim();
    expectOk(await call('post', `/warranty-claims/${claimId}/resolve`, { resolution, notes: 'Checked' }));
    const { rows: [claim] } = await db.query(`SELECT status, resolution FROM warranty_claims WHERE id = $1`, [claimId]);
    expect(claim).toEqual({ status: resolution === 'rejected' ? 'rejected' : 'resolved', resolution });
  });

  it('resolves a warranty claim as replaced (stock out + new warranty)', async () => {
    const claimId = await openClaim();
    expectOk(await call('post', `/warranty-claims/${claimId}/resolve`, { resolution: 'replaced' }));
    const { rows: [claim] } = await db.query(`SELECT status, resolution FROM warranty_claims WHERE id = $1`, [claimId]);
    expect(claim).toEqual({ status: 'resolved', resolution: 'replaced' });
    const { rows: [v] } = await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [variantId]);
    expect(Number(v.stock_qty)).toBe(9);
  });

  // --- SELECT … LEFT JOIN … FOR UPDATE (0A000) --------------------------------
  it.each([
    ['approve', {}, 'approved', '2026-11-02'],
    ['reject', { rejectionReason: 'Busy week' }, 'rejected', '2026-11-09'],
  ])('can %s a leave request', async (action, body, status, startDate) => {
    const submitted = await call('post', '/leaves', {
      employeeId, leaveType: 'unpaid', startDate, endDate: startDate, reason: 'Family matter',
    });
    expectOk(submitted, 201);
    expectOk(await call('put', `/leaves/${submitted.body.data.id}/${action}`, body));
    const { rows: [leave] } = await db.query(`SELECT status FROM leaves WHERE id = $1`, [submitted.body.data.id]);
    expect(leave.status).toBe(status);
  });

  it.each([
    ['approve', '2026-09-14'],
    ['reject', '2026-09-15'],
  ])('can %s an attendance correction', async (action, date) => {
    const { rows: [att] } = await db.query(
      `INSERT INTO attendance (employee_id, date, check_in, status)
       VALUES ($1, $2::date, $2::date + TIME '09:30', 'present') RETURNING id`,
      [employeeId, date],
    );
    const submitted = await call('post', '/attendance/corrections', {
      attendanceId: att.id, reason: 'wrong_time', requestNote: 'Arrived at nine',
      newCheckIn: `${date}T09:00:00+04:00`,
    });
    expectOk(submitted, 201);
    const body = action === 'reject' ? { reviewNote: 'No proof', rejectionReason: 'No proof' } : {};
    expectOk(await call('put', `/attendance/corrections/${submitted.body.data.id}/${action}`, body));
    const { rows: [row] } = await db.query(`SELECT check_in FROM attendance WHERE id = $1`, [att.id]);
    // Approved: the corrected 09:00 Dubai check-in; rejected: unchanged 09:30.
    const expected = action === 'approve' ? `${date}T09:00:00+04:00` : null;
    if (expected) expect(new Date(row.check_in).toISOString()).toBe(new Date(expected).toISOString());
    else expect(row.check_in).not.toBeNull();
  });

  it('can pay a scheduled bill', async () => {
    const bill = await call('post', '/bills', {
      name: 'Internet', amount: 300, frequency: 'monthly', startDate: '2026-09-01', paymentMethod: 'bank',
    });
    expectOk(bill, 201);
    const { rows: [payment] } = await db.query(
      `SELECT id FROM bill_payments WHERE bill_id = $1 ORDER BY due_date LIMIT 1`, [bill.body.data.id]);
    expect(payment).toBeTruthy();
    expectOk(await call('post', `/bill-payments/${payment.id}/pay`, { amountPaid: 300, paymentMethod: 'bank' }));
    const { rows: [paid] } = await db.query(`SELECT status FROM bill_payments WHERE id = $1`, [payment.id]);
    expect(paid.status).toBe('paid');
  });

  // --- return_requests.requested_at (42703) ----------------------------------
  it('builds the period-close checklist and closes a period without force', async () => {
    const { rows: [period] } = await db.query(
      `SELECT id FROM financial_periods WHERE name = 'January 2026' AND period_type = 'monthly'`,
    );
    const checklist = await call('get', `/finance/periods/${period.id}/checklist`);
    expectOk(checklist);
    expectOk(await call('post', `/finance/periods/${period.id}/close`, {}));
  });

  it('global search works for a user with return permissions', async () => {
    const res = await call('get', '/search?q=Fan');
    expectOk(res);
    expect(Array.isArray(res.body.data.returns)).toBe(true);
  });

  // --- suppliers.trn_number (42703) ------------------------------------------
  it('loads a purchase order for its PDF', async () => {
    const created = await call('post', '/purchase-orders', {
      supplierId, items: [{ productId, variantId, quantity: 1, costPricePerUnit: 180 }],
    });
    expectOk(created, 201);
    const { fetchPurchaseOrder } = require('../../server/services/pdfService');
    const { po } = await fetchPurchaseOrder(created.body.data.id);
    expect(po).toMatchObject({ supplier_name: 'Fan Supplier', supplier_trn: null });
  });

  // --- stale-draft sweep ------------------------------------------------------
  it('the stale-draft sweep cancels drafts older than the threshold only', async () => {
    const { rows: [old] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, created_by, created_at)
       VALUES ('INV-TEST-OLD', 'draft', $1, NOW() - INTERVAL '48 hours') RETURNING id`,
      [adminId],
    );
    const { rows: [fresh] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, created_by) VALUES ('INV-TEST-NEW', 'draft', $1) RETURNING id`,
      [adminId],
    );
    await require('../../server/jobs/staleDraftInvoices').sweep();
    const { rows } = await db.query(
      `SELECT id, status, cancel_reason FROM invoices WHERE id = ANY($1)`, [[old.id, fresh.id]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[old.id]).toMatchObject({ status: 'cancelled', cancel_reason: 'auto-cancelled: draft older than 24h' });
    expect(byId[fresh.id].status).toBe('draft');
  });

  // --- dynamically assembled queries the static sweep could only approximate --
  it.each([
    ['/holidays?year=2026'],
    ['/customers?search=Fan&hasBalance=true&isActive=true'],
    [() => `/customers/${customerId}`],
    ['/suppliers?search=Fan'],
    [() => `/suppliers/${supplierId}`],
  ])('runs dynamic query %s', async (pathOrFn) => {
    const path = typeof pathOrFn === 'function' ? pathOrFn() : pathOrFn;
    expectOk(await call('get', path));
  });

  it('runs the employee performance report with and without an employee filter', async () => {
    const reportService = require('../../server/services/reportService');
    await expect(reportService.generateReport('employee_performance', {})).resolves.toHaveProperty('rows');
    await expect(reportService.generateReport('employee_performance', { employee_id: adminId }))
      .resolves.toHaveProperty('rows');
  });
});
