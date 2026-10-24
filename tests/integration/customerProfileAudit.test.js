/**
 * Customer profile: financial cards, audit trail and timeline.
 *
 * - cards: net spend (confirmed sales minus refunds), confirmation time as
 *   last purchase, checkout payments counted as payments
 * - edits: exact old/new per changed field, no entry for a no-op save,
 *   status changes as their own event, 409 on a stale edit
 * - audit is part of the change: if the entry can't be written, the change
 *   is rolled back; the log itself is append-only
 * - timeline loads with invoices present and pages by cursor
 * - voided payments stay on record; inactive customers can't take credit
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('customer profile audit on real PostgreSQL', () => {
  let db, admin, app, request, token, userId, customerId;
  const database = `customer_profile_audit_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const api = () => ({
    get: (url) => request(app).get(url).auth(token, { type: 'bearer' }),
    put: (url, body) => request(app).put(url).auth(token, { type: 'bearer' }).send(body),
    post: (url, body) => request(app).post(url).auth(token, { type: 'bearer' }).send(body),
    del: (url) => request(app).delete(url).auth(token, { type: 'bearer' }),
  });

  async function invoice(number, status, total, { createdAt, confirmedAt = null, cancelledAt = null, payments = [] } = {}) {
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, customer_id, subtotal, discount_amount, taxable_amount,
                             tax_amount, total, amount_paid, balance_due, payment_status, created_at,
                             confirmed_at, cancelled_at, created_by, confirmed_by, cancelled_by)
       VALUES ($1,$2,$3,$4,0,$4,0,$4,$4,0,'paid',$5,$6,$7,$8,$8,$8) RETURNING id`,
      [number, status, customerId, total, createdAt, confirmedAt, cancelledAt, userId],
    );
    for (const [method, amount, at] of payments) {
      await db.query(
        `INSERT INTO invoice_payments (invoice_id, method, amount, timestamp) VALUES ($1,$2,$3,$4)`,
        [inv.id, method, amount, at],
      );
    }
    return inv.id;
  }

  async function auditRows(action) {
    const { rows } = await db.query(
      `SELECT * FROM activity_log WHERE entity_id = $1 AND action = $2 ORDER BY timestamp`,
      [customerId, action],
    );
    return rows;
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
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/customers', require('../../server/routes/customers'));
    app.use('/customer-payments', require('../../server/routes/customerPayments'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));

    const res = await api().post('/customers', { name: 'Omar Lights', phone: '0509876543', creditLimit: 1000 });
    customerId = res.body.data.id;
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  describe('creation', () => {
    it('records the creator and an initial snapshot in the same transaction', async () => {
      const res = await api().get(`/customers/${customerId}`);
      expect(res.body.data).toMatchObject({ createdBy: userId, createdByUsername: 'admin' });
      const [created] = await auditRows('customer.created');
      expect(created.new_value).toMatchObject({ name: 'Omar Lights', phone: '0509876543', creditLimit: 1000, isActive: true });
      expect(created.performed_by_name).toBe('admin');
    });

    it('a retried create with the same request key returns the first customer', async () => {
      const body = { name: 'Retry Co', requestKey: `key-${randomUUID()}` };
      const first = await api().post('/customers', body);
      const second = await api().post('/customers', body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM customers WHERE name = 'Retry Co'`);
      expect(rows[0].n).toBe(1);
    });
  });

  describe('edits', () => {
    it('logs exact old and new values for changed fields only', async () => {
      const res = await api().put(`/customers/${customerId}`, {
        name: 'Omar Lights', phone: '0509876543', email: 'omar@example.com', creditLimit: 1000,
      });
      expect(res.status).toBe(200);
      const [entry] = await auditRows('customer.updated');
      expect(entry.old_value).toEqual({ email: null });
      expect(entry.new_value).toEqual({ email: 'omar@example.com' });
    });

    it('a save with nothing changed writes nothing', async () => {
      const before = (await api().get(`/customers/${customerId}`)).body.data;
      const res = await api().put(`/customers/${customerId}`, {
        name: 'Omar Lights', phone: '0509876543', email: 'omar@example.com', creditLimit: 1000,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.updatedAt).toBe(before.updatedAt);
      expect(await auditRows('customer.updated')).toHaveLength(1);
    });

    it('credit limit and status changes get their own events', async () => {
      await api().put(`/customers/${customerId}`, { creditLimit: 2000, isActive: false });
      const [limit] = await auditRows('customer.credit_limit_updated');
      expect(limit.old_value).toEqual({ creditLimit: 1000 });
      expect(limit.new_value).toEqual({ creditLimit: 2000 });
      const [status] = await auditRows('customer.status_changed');
      expect(status.old_value).toEqual({ isActive: true });
      expect(status.new_value).toEqual({ isActive: false });
      await api().put(`/customers/${customerId}`, { isActive: true });
      expect(await auditRows('customer.status_changed')).toHaveLength(2);
    });

    it('rejects an edit made on a stale copy and keeps the newer value', async () => {
      const loaded = (await api().get(`/customers/${customerId}`)).body.data;
      // Someone else saves first.
      await api().put(`/customers/${customerId}`, { address: 'Deira', expectedUpdatedAt: loaded.updatedAt });
      const stale = await api().put(`/customers/${customerId}`, { address: 'Karama', expectedUpdatedAt: loaded.updatedAt });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('RESOURCE_CONFLICT');
      const now = (await api().get(`/customers/${customerId}`)).body.data;
      expect(now.address).toBe('Deira');
    });

    it('rolls the edit back when its audit entry cannot be written', async () => {
      await db.query(
        `ALTER TABLE activity_log ADD CONSTRAINT test_block_update CHECK (action <> 'customer.updated') NOT VALID`,
      );
      try {
        const res = await api().put(`/customers/${customerId}`, { notes: 'should not stick' });
        expect(res.status).toBe(500);
      } finally {
        await db.query(`ALTER TABLE activity_log DROP CONSTRAINT test_block_update`);
      }
      const { rows } = await db.query(`SELECT notes FROM customers WHERE id = $1`, [customerId]);
      expect(rows[0].notes).toBeNull();
    });
  });

  it('activity log rows cannot be changed or deleted', async () => {
    await expect(db.query(`UPDATE activity_log SET notes = 'x' WHERE entity_id = $1`, [customerId]))
      .rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM activity_log WHERE entity_id = $1`, [customerId]))
      .rejects.toThrow(/append-only/);
  });

  describe('financial cards', () => {
    beforeAll(async () => {
      // Draft created on 1 Oct, confirmed on 3 Oct: purchase time is the confirmation.
      const sale = await invoice('INV-PA-1', 'confirmed', 100, {
        createdAt: '2026-10-01T09:00:00Z', confirmedAt: '2026-10-03T15:30:00Z',
        payments: [['cash', 100, '2026-10-03T15:30:00Z']],
      });
      await invoice('INV-PA-2', 'cancelled', 400, {
        createdAt: '2026-10-04T09:00:00Z', confirmedAt: '2026-10-04T09:05:00Z', cancelledAt: '2026-10-04T11:00:00Z',
      });
      await invoice('INV-PA-3', 'draft', 999, { createdAt: '2026-10-05T09:00:00Z' });
      // AED 25 refunded on a partial return.
      await db.query(
        `INSERT INTO return_orders (return_order_number, return_type, customer_id, original_invoice_id,
                                    employee_id, total_value, refund_total, created_at)
         VALUES ('RO-PA-1', 'customer_refund', $1, $2, $3, 25, 25, '2026-10-04T10:00:00Z')`,
        [customerId, sale, userId],
      );
    });

    it('nets refunds and counts only confirmed sales', async () => {
      const c = (await api().get(`/customers/${customerId}`)).body.data;
      expect(c).toMatchObject({ grossSpent: 100, refundedTotal: 25, totalSpent: 75, invoiceCount: 1, avgOrderValue: 75 });
    });

    it('last purchase is the confirmation time, last payment includes checkout', async () => {
      const c = (await api().get(`/customers/${customerId}`)).body.data;
      expect(new Date(c.lastPurchaseAt).toISOString()).toBe('2026-10-03T15:30:00.000Z');
      expect(new Date(c.lastPaymentAt).toISOString()).toBe('2026-10-03T15:30:00.000Z');
    });

    it('payments history includes checkout payments', async () => {
      const res = await api().get(`/customers/${customerId}/payments?include=all`);
      expect(res.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ source: 'invoice', amount: 100, invoiceNumber: 'INV-PA-1' })]),
      );
      expect(res.body.meta.totals.totalCheckout).toBe(100);
    });
  });

  describe('timeline', () => {
    it('loads with invoices present and labels each event by what happened', async () => {
      const res = await api().get(`/customers/${customerId}/timeline?limit=200`);
      expect(res.status).toBe(200);
      const events = res.body.data.map((e) => e.event);
      expect(events).toEqual(expect.arrayContaining([
        'invoice_confirmed', 'invoice_cancelled', 'invoice_created', 'return_processed', 'profile_updated',
      ]));
      const confirmed = res.body.data.find((e) => e.event === 'invoice_confirmed' && e.label === 'INV-PA-1');
      expect(confirmed).toMatchObject({ employeeUsername: 'admin', amount: 100 });
      const edit = res.body.data.find((e) => e.status === 'customer.updated');
      expect(edit.newValue).toBeTruthy();
      const times = res.body.data.map((e) => new Date(e.at).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('pages by cursor without gaps or repeats', async () => {
      const all = (await api().get(`/customers/${customerId}/timeline?limit=200`)).body.data;
      const seen = [];
      let before = null;
      do {
        const url = `/customers/${customerId}/timeline?limit=3${before ? `&before=${before}` : ''}`;
        const page = (await api().get(url)).body;
        seen.push(...page.data);
        before = page.meta.nextCursor;
      } while (before);
      expect(seen.map((e) => `${e.event}:${e.referenceId}`)).toEqual(all.map((e) => `${e.event}:${e.referenceId}`));
    });

    it('rejects a malformed cursor', async () => {
      expect((await api().get(`/customers/${customerId}/timeline?before=garbage`)).status).toBe(400);
    });
  });

  it('a voided payment stays on record with who voided it', async () => {
    await db.query(`UPDATE customers SET credit_balance = 300 WHERE id = $1`, [customerId]);
    const bank = await require('../../server/services/bankService').createAccount(
      { bankName: 'Test Bank', accountName: 'Store', isDefault: true }, userId,
    );
    const collected = await api().post(`/customers/${customerId}/payments`, {
      amount: 50, paymentMethod: 'bank_transfer', bankAccountId: bank.id,
    });
    expect(collected.status, JSON.stringify(collected.body)).toBe(201);
    const paymentId = collected.body.data.payment.id;
    expect(await auditRows('customer.payment_collected')).toHaveLength(1);

    const voided = await api().del(`/customer-payments/${paymentId}`);
    expect(voided.status).toBe(200);
    const { rows } = await db.query(`SELECT * FROM customer_payment_voids WHERE id = $1`, [paymentId]);
    expect(rows[0]).toMatchObject({ voided_by: userId, payment_method: 'bank_transfer' });
    expect(Number(rows[0].amount)).toBe(50);

    const history = (await api().get(`/customers/${customerId}/payments?include=all`)).body.data;
    expect(history.find((p) => p.id === paymentId)).toMatchObject({ voidedByUsername: 'admin' });
    const timeline = (await api().get(`/customers/${customerId}/timeline?limit=200`)).body.data;
    expect(timeline.some((e) => e.event === 'payment_voided' && e.referenceId === paymentId)).toBe(true);
  });

  it('an inactive customer cannot take on credit', async () => {
    const { assertWithinCreditLimit } = require('../../server/services/customerService');
    await db.query(`UPDATE customers SET is_active = false WHERE id = $1`, [customerId]);
    try {
      await expect(db.withTransaction((client) => assertWithinCreditLimit(client, customerId, 10)))
        .rejects.toMatchObject({ status: 409 });
    } finally {
      await db.query(`UPDATE customers SET is_active = true WHERE id = $1`, [customerId]);
    }
  });
});
