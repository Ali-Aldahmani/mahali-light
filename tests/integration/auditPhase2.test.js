/**
 * Phase 2 of the audit fix plan: operations succeed or fail as a whole.
 *
 * Failures are forced with test-only triggers, then every table the
 * operation touches is checked for leftovers.
 *
 * - a direct stock adjustment commits its stock move, journal, approval
 *   record and audit entry together
 * - a failed audit write rolls back the cash adjustment / supplier payment
 *   it records
 * - sale warranties are created and voided inside the sale's own
 *   confirm / cancel transaction
 * - a partial return keeps warranty cover for the units still with the
 *   customer; the last unit back voids it
 * - a supplier cash payment is refused when the drawer is closed
 * - deleting an expense removes its receipt only after the delete commits
 * - cashiers can no longer edit or void warranties; custom roles that could
 *   keep that ability through migration 039
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('audit phase 2 on real PostgreSQL', () => {
  let admin, db, auth, invoices, returns, paymentsCtrl, app, request, adminId, uploads;
  const database = `audit_phase2_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
  const stock = async (id) =>
    Number((await db.query('SELECT stock_qty FROM product_variants WHERE id=$1', [id])).rows[0].stock_qty);
  const cash = async () => Number((await db.query('SELECT current_balance FROM cash_drawer LIMIT 1')).rows[0].current_balance);

  async function variant({ price = 100, cost = 40, stock: qty = 20, warrantyMonths = 0 } = {}) {
    const product = (await db.query(
      `INSERT INTO products (name, default_warranty_months) VALUES ('Phase 2 item', $1) RETURNING id`,
      [warrantyMonths],
    )).rows[0];
    return (await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [product.id, randomUUID(), price, cost, qty],
    )).rows[0];
  }

  async function draft({ v, quantity = 1, price = 100, serial = null } = {}) {
    const inv = (await db.query(
      `INSERT INTO invoices (invoice_number, tax_rate) VALUES ($1, 0) RETURNING *`,
      [randomUUID()],
    )).rows[0];
    await db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [
        { variant_id: v.id, quantity, unit_price: price, serial_number: serial },
      ]);
      await invoices.recalculateAndPersistTotals(client, inv.id);
    });
    return (await db.query('SELECT * FROM invoices WHERE id=$1', [inv.id])).rows[0];
  }

  async function pay(inv) {
    const res = await request(app).post(`/invoices/${inv.id}/payments`)
      .send({ amount: Number(inv.total), method: 'cash', idempotencyKey: randomUUID() });
    expect(res.status).toBe(201);
  }

  async function sale(opts) {
    const inv = await draft(opts);
    await pay(inv);
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: adminId });
    return inv;
  }

  async function failAuditFor(action) {
    await db.query(`INSERT INTO test_fail_audit (action) VALUES ($1)`, [action]);
  }

  async function userWithRole(roleName) {
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, 'x', $2) RETURNING id`,
      [`${roleName.toLowerCase()}-${randomUUID().slice(0, 8)}`, role.id],
    );
    const token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [u.id, auth.hashToken(token)]);
    return token;
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      PGHOST: '127.0.0.1', PGPORT: process.env.INVOICE_TEST_PG_PORT,
      PGUSER: process.env.INVOICE_TEST_PG_USER || 'postgres',
      PGPASSWORD: process.env.INVOICE_TEST_PG_PASSWORD || '', PGDATABASE: database,
    });
    uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-phase2-uploads-'));
    process.env.UPLOADS_DIR = uploads;
    const { Pool } = require('pg');
    admin = new Pool({ database: 'postgres' });
    await admin.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;
    db = require('../../server/db/postgres');
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();
    await db.query(`INSERT INTO financial_periods (name,period_type,start_date,end_date)
      SELECT 'Phase 2 current year','yearly',date_trunc('year', CURRENT_DATE)::date,
        (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date
      WHERE NOT EXISTS (SELECT 1 FROM financial_periods WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)`);

    // Test-only fault injection: fail any audit insert whose action is listed.
    await db.query(`CREATE TABLE test_fail_audit (action TEXT PRIMARY KEY)`);
    await db.query(`CREATE FUNCTION test_fail_audit_fn() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM test_fail_audit WHERE action = NEW.action) THEN
          RAISE EXCEPTION 'forced audit failure for %', NEW.action;
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.query(`CREATE TRIGGER test_fail_audit_trg BEFORE INSERT ON activity_log
      FOR EACH ROW EXECUTE FUNCTION test_fail_audit_fn()`);

    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    auth = require('../../server/middleware/auth');
    invoices = require('../../server/services/invoiceService');
    returns = require('../../server/services/returnService');
    paymentsCtrl = require('../../server/controllers/invoicePaymentsController');
    ({ rows: [{ id: adminId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    const asAdmin = (permissions) => (req, _res, next) => {
      req.user = { id: adminId, permissions };
      req.app.set('io', null);
      next();
    };
    app.post('/invoices/:id/payments', asAdmin([]), paymentsCtrl.create);
    app.post('/stock/adjustments', asAdmin(['stock.adjust_direct']),
      require('../../server/controllers/stockAdjustmentsController').create);
    app.use('/warranties', require('../../server/routes/warranties'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
    if (uploads) fs.rmSync(uploads, { recursive: true, force: true });
  });

  describe('direct stock adjustment', () => {
    const body = (v) => ({
      variantId: v.id, adjustmentType: 'remove', quantity: 3, reason: 'damaged',
      note: 'Dropped during unpacking', applyDirectly: true,
    });

    it('leaves nothing behind when its approval record cannot be written', async () => {
      const v = await variant({ stock: 10 });
      const journalsBefore = await count(`SELECT COUNT(*) AS n FROM journal_entries`);
      await db.query(`CREATE FUNCTION test_fail_adjustment() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'forced failure'; END $$ LANGUAGE plpgsql`);
      await db.query(`CREATE TRIGGER test_fail_adjustment_trg BEFORE INSERT ON stock_adjustment_requests
        FOR EACH ROW EXECUTE FUNCTION test_fail_adjustment()`);
      try {
        const res = await request(app).post('/stock/adjustments').send(body(v));
        expect(res.status).toBe(500);
      } finally {
        await db.query(`DROP TRIGGER test_fail_adjustment_trg ON stock_adjustment_requests`);
        await db.query(`DROP FUNCTION test_fail_adjustment()`);
      }
      expect(await stock(v.id)).toBe(10);
      expect(await count(`SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = $1`, [v.id])).toBe(0);
      expect(await count(`SELECT COUNT(*) AS n FROM journal_entries`)).toBe(journalsBefore);
    });

    it('commits stock move, approval record and audit entry together', async () => {
      const v = await variant({ stock: 10 });
      const res = await request(app).post('/stock/adjustments').send(body(v));
      expect(res.status).toBe(201);
      expect(await stock(v.id)).toBe(7);
      const { rows: [reqRow] } = await db.query(
        `SELECT a.applied_movement_id, m.quantity::float8 AS qty
           FROM stock_adjustment_requests a JOIN stock_movements m ON m.id = a.applied_movement_id
          WHERE a.variant_id = $1`,
        [v.id],
      );
      expect(reqRow.qty).toBe(-3);
      expect(await count(`SELECT COUNT(*) AS n FROM activity_log WHERE action = 'stock.adjustment_approved' AND entity_id = $1`, [res.body.data?.id ?? res.body.id])).toBe(1);
    });
  });

  describe('audit entries commit with what they record', () => {
    it('a failed audit write rolls back a manual cash adjustment', async () => {
      const cashService = require('../../server/services/cashService');
      await cashService.recordManualAdjustment({ amount: 500, direction: 'in', reason: 'Float', employeeId: adminId });
      const before = await cash();
      await failAuditFor('cash_drawer.adjusted');
      try {
        await expect(cashService.recordManualAdjustment({
          amount: 50, direction: 'out', reason: 'Petty cash', employeeId: adminId,
        })).rejects.toThrow(/forced audit failure/);
      } finally {
        await db.query(`DELETE FROM test_fail_audit`);
      }
      expect(await cash()).toBe(before);
      expect(await count(`SELECT COUNT(*) AS n FROM cash_drawer_transactions WHERE notes = 'Petty cash'`)).toBe(0);
    });

    it('a failed audit write rolls back a supplier payment', async () => {
      const payments = require('../../server/services/supplierPaymentService');
      const { rows: [s] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Audit Co') RETURNING id`);
      const { rows: [po] } = await db.query(
        `INSERT INTO purchase_orders (po_number, supplier_id, status, total_cost, amount_paid, balance_due)
         VALUES ('PO-AUDIT-1', $1, 'received', 100, 0, 100) RETURNING id`,
        [s.id],
      );
      await failAuditFor('purchase_order.payment_added');
      try {
        await expect(payments.addPayment({
          poId: po.id, amount: 40, method: 'cash', employeeId: adminId,
        })).rejects.toThrow(/forced audit failure/);
      } finally {
        await db.query(`DELETE FROM test_fail_audit`);
      }
      expect(await count(`SELECT COUNT(*) AS n FROM supplier_payments WHERE purchase_order_id = $1`, [po.id])).toBe(0);
      const { rows: [after] } = await db.query(`SELECT amount_paid::float8 AS paid FROM purchase_orders WHERE id = $1`, [po.id]);
      expect(after.paid).toBe(0);
    });
  });

  describe('sale warranties', () => {
    it('are created by the confirmation itself', async () => {
      const v = await variant({ warrantyMonths: 12 });
      const inv = await sale({ v });
      expect(await count(`SELECT COUNT(*) AS n FROM warranties WHERE invoice_id = $1 AND status = 'active'`, [inv.id])).toBe(1);
      expect(await count(`SELECT COUNT(*) AS n FROM activity_log WHERE action = 'invoice.confirmed' AND entity_id = $1`, [inv.id])).toBe(1);
    });

    it('a warranty that cannot be created stops the sale instead of leaving it without cover', async () => {
      const v = await variant({ warrantyMonths: 12, stock: 5 });
      await db.query(
        `INSERT INTO warranties (warranty_number, product_id, variant_id, serial_number, start_date, end_date, duration_months)
         VALUES ('W-EXISTING', $1, $2, 'SN-TAKEN', CURRENT_DATE, CURRENT_DATE + 365, 12)`,
        [v.product_id, v.id],
      );
      const inv = await draft({ v, serial: 'SN-TAKEN' });
      await pay(inv);
      await expect(invoices.confirmInvoice({ invoiceId: inv.id, employeeId: adminId })).rejects.toBeTruthy();
      const { rows: [after] } = await db.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id]);
      expect(after.status).toBe('draft');
      expect(await stock(v.id)).toBe(5);
    });

    it('are voided by the cancellation itself', async () => {
      const v = await variant({ warrantyMonths: 12 });
      const inv = await sale({ v });
      await invoices.cancelInvoice({ invoiceId: inv.id, employeeId: adminId, reason: 'Customer changed mind' });
      expect(await count(`SELECT COUNT(*) AS n FROM warranties WHERE invoice_id = $1 AND status = 'void'`, [inv.id])).toBe(1);
    });
  });

  describe('returns and warranty cover', () => {
    it('a partial return keeps cover; returning the last unit voids it', async () => {
      const v = await variant({ warrantyMonths: 12, price: 100 });
      const inv = await sale({ v, quantity: 2, price: 100 });
      const line = (await db.query('SELECT id FROM invoice_items WHERE invoice_id = $1', [inv.id])).rows[0];
      const giveBack = async () => {
        const { request } = await returns.createReturnRequest({
          returnType: 'customer_refund', referenceType: 'invoice', referenceId: inv.id,
          reason: 'customer_request', requestNote: 'Phase 2 partial return', requestedBy: adminId,
          items: [{ invoiceItemId: line.id, quantity: 1, condition: 'good' }],
          refundPlan: [{ method: 'cash', amount: 100 }],
        });
        await returns.approveAndExecute({ requestId: request.id, managerId: adminId });
      };
      const statusOf = async () => (await db.query(`SELECT status FROM warranties WHERE invoice_id = $1`, [inv.id])).rows[0].status;

      await giveBack();
      expect(await statusOf()).toBe('active');
      await giveBack();
      expect(await statusOf()).toBe('void');
    });
  });

  describe('expense receipts', () => {
    it('stay on disk when the expense delete rolls back', async () => {
      const expenses = require('../../server/services/expenseService');
      const cashService = require('../../server/services/cashService');
      await cashService.recordManualAdjustment({ amount: 200, direction: 'in', reason: 'Float', employeeId: adminId });
      const expense = await expenses.createExpense({
        description: 'Light bulbs for showroom', amount: 20, paymentMethod: 'cash', userId: adminId,
      });
      const rel = `expenses/${expense.id}/receipt.txt`;
      fs.mkdirSync(path.join(uploads, 'expenses', expense.id), { recursive: true });
      fs.writeFileSync(path.join(uploads, rel), 'receipt');
      await expenses.setExpenseReceipt(expense.id, rel);

      await failAuditFor('expense.deleted');
      try {
        await expect(expenses.deleteExpense({ id: expense.id, userId: adminId })).rejects.toThrow(/forced audit failure/);
      } finally {
        await db.query(`DELETE FROM test_fail_audit`);
      }
      expect(await count(`SELECT COUNT(*) AS n FROM one_time_expenses WHERE id = $1`, [expense.id])).toBe(1);
      expect(fs.existsSync(path.join(uploads, rel))).toBe(true);

      await expenses.deleteExpense({ id: expense.id, userId: adminId });
      expect(fs.existsSync(path.join(uploads, rel))).toBe(false);
    });
  });

  describe('warranty edit and void permissions', () => {
    it('a cashier can no longer edit or void a warranty; a manager can void', async () => {
      const v = await variant();
      const { rows: [w] } = await db.query(
        `INSERT INTO warranties (warranty_number, product_id, variant_id, start_date, end_date, duration_months)
         VALUES ('W-PERM-1', $1, $2, CURRENT_DATE, CURRENT_DATE + 365, 12) RETURNING id`,
        [v.product_id, v.id],
      );
      const cashier = await userWithRole('Cashier');
      const manager = await userWithRole('Manager');

      const edit = await request(app).put(`/warranties/${w.id}`).auth(cashier, { type: 'bearer' }).send({ notes: 'x' });
      expect(edit.status).toBe(403);
      const cashierVoid = await request(app).post(`/warranties/${w.id}/void`).auth(cashier, { type: 'bearer' }).send({ reason: 'x' });
      expect(cashierVoid.status).toBe(403);

      const managerVoid = await request(app).post(`/warranties/${w.id}/void`).auth(manager, { type: 'bearer' }).send({ reason: 'Sold in error' });
      expect(managerVoid.status).toBe(200);
    });

    it('migration 039 keeps edit/void for custom roles that could create warranties', async () => {
      const { rows: [role] } = await db.query(`INSERT INTO roles (name, is_system) VALUES ('Senior Cashier', false) RETURNING id`);
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = 'warranty.create'`,
        [role.id],
      );
      const sql = fs.readFileSync(path.join(process.cwd(), 'server/db/migrations/039_warranty_edit_void_permissions.sql'), 'utf8');
      await db.query(sql);
      const { rows } = await db.query(
        `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = $1 ORDER BY p.key`,
        [role.id],
      );
      expect(rows.map((r) => r.key)).toEqual(['warranty.create', 'warranty.edit', 'warranty.void']);
      // The system Cashier role is re-synced by the seeder and stays without them.
      const { rows: cashierPerms } = await db.query(
        `SELECT p.key FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
           JOIN roles r ON r.id = rp.role_id WHERE r.name = 'Cashier' AND p.key LIKE 'warranty.%' ORDER BY p.key`,
      );
      expect(cashierPerms.map((r) => r.key)).toEqual(['warranty.create', 'warranty.view']);
    });
  });

  describe('supplier cash payment', () => {
    it('is refused while the drawer is closed instead of silently opening it', async () => {
      const payments = require('../../server/services/supplierPaymentService');
      await db.query(`UPDATE cash_drawer_sessions SET status = 'closed', closed_at = NOW() WHERE status = 'open'`);
      await db.query(`UPDATE cash_drawer SET status = 'closed'`);
      const sessionsBefore = await count(`SELECT COUNT(*) AS n FROM cash_drawer_sessions`);
      const { rows: [s] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Closed Drawer Co') RETURNING id`);
      const { rows: [po] } = await db.query(
        `INSERT INTO purchase_orders (po_number, supplier_id, status, total_cost, amount_paid, balance_due)
         VALUES ('PO-DRAWER-1', $1, 'received', 100, 0, 100) RETURNING id`,
        [s.id],
      );
      await expect(payments.addPayment({ poId: po.id, amount: 30, method: 'cash', employeeId: adminId }))
        .rejects.toMatchObject({ code: 'BIZ_DRAWER_CLOSED', status: 409 });
      expect(await count(`SELECT COUNT(*) AS n FROM supplier_payments WHERE purchase_order_id = $1`, [po.id])).toBe(0);
      expect(await count(`SELECT COUNT(*) AS n FROM cash_drawer_sessions`)).toBe(sessionsBefore);
    });
  });
});
