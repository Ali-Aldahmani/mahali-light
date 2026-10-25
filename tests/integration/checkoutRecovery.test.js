/**
 * Checkout recovery (Phase 3 of the audit fix plan).
 *
 * - creating a draft with a checkout ID that already has an invoice returns
 *   that invoice (200), so one sale attempt can never become two invoices
 * - GET /invoices/checkout/:checkoutId reports what became of an attempt
 *   whose response was lost: none, draft, confirmed (with totals and
 *   warranties for the receipt) or cancelled
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('checkout recovery on real PostgreSQL', () => {
  let db, admin, app, request, token, userId, invoices;
  const database = `checkout_recovery_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const api = () => ({
    get: (url) => request(app).get(url).auth(token, { type: 'bearer' }),
    post: (url, body) => request(app).post(url).auth(token, { type: 'bearer' }).send(body),
  });
  const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

  async function variant(warrantyMonths = 0) {
    const p = (await db.query(
      `INSERT INTO products (name, default_warranty_months) VALUES ('Checkout item', $1) RETURNING id`,
      [warrantyMonths],
    )).rows[0];
    return (await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 100, 40, 20) RETURNING id`,
      [p.id, randomUUID()],
    )).rows[0];
  }

  const draftBody = (v, checkoutId) => ({
    checkoutId,
    items: [{ variantId: v.id, quantity: 1, unitPrice: 100 }],
  });

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
    await db.query(`INSERT INTO financial_periods (name,period_type,start_date,end_date)
      SELECT 'Checkout current year','yearly',date_trunc('year', CURRENT_DATE)::date,
        (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year - 1 day')::date
      WHERE NOT EXISTS (SELECT 1 FROM financial_periods WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)`);
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    invoices = require('../../server/services/invoiceService');
    const auth = require('../../server/middleware/auth');
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('a retried draft with the same checkout ID returns the first invoice', async () => {
    const v = await variant();
    const checkoutId = randomUUID();
    const first = await api().post('/invoices', draftBody(v, checkoutId));
    const second = await api().post('/invoices', draftBody(v, checkoutId));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.checkoutId).toBe(checkoutId);
    expect(await count(`SELECT COUNT(*) AS n FROM invoices WHERE checkout_id = $1`, [checkoutId])).toBe(1);
  });

  it('simultaneous drafts with one checkout ID make one invoice', async () => {
    const v = await variant();
    const checkoutId = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => api().post('/invoices', draftBody(v, checkoutId))));
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM invoices WHERE checkout_id = $1`, [checkoutId])).toBe(1);
  });

  it('drafts without a checkout ID still each get their own invoice', async () => {
    const v = await variant();
    const a = await api().post('/invoices', { items: [{ variantId: v.id, quantity: 1, unitPrice: 100 }] });
    const b = await api().post('/invoices', { items: [{ variantId: v.id, quantity: 1, unitPrice: 100 }] });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  describe('status lookup', () => {
    it("an attempt that never reached the server is 'none'", async () => {
      const res = await api().get(`/invoices/checkout/${randomUUID()}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'none', invoice: null, warranties: [] });
    });

    it('follows the attempt from draft to confirmed, with the receipt figures and warranties', async () => {
      const v = await variant(12);
      const checkoutId = randomUUID();
      const draft = (await api().post('/invoices', draftBody(v, checkoutId))).body.data;
      expect((await api().get(`/invoices/checkout/${checkoutId}`)).body.data.status).toBe('draft');

      await db.query(
        `INSERT INTO invoice_payments (invoice_id, method, amount, idempotency_key) VALUES ($1, 'cash', $2, $3)`,
        [draft.id, draft.total, randomUUID()],
      );
      await db.withTransaction((client) => invoices.recalculateAndPersistTotals(client, draft.id));
      await invoices.confirmInvoice({ invoiceId: draft.id, employeeId: userId });

      const res = await api().get(`/invoices/checkout/${checkoutId}`);
      expect(res.body.data.status).toBe('confirmed');
      expect(res.body.data.invoice).toMatchObject({
        id: draft.id, invoiceNumber: draft.invoiceNumber, total: draft.total, balanceDue: 0,
      });
      expect(res.body.data.warranties).toHaveLength(1);
    });

    it("a cancelled sale is reported as 'cancelled'", async () => {
      const v = await variant();
      const checkoutId = randomUUID();
      const draft = (await api().post('/invoices', draftBody(v, checkoutId))).body.data;
      await db.query(`UPDATE invoices SET status = 'cancelled' WHERE id = $1`, [draft.id]);
      expect((await api().get(`/invoices/checkout/${checkoutId}`)).body.data.status).toBe('cancelled');
    });
  });
});
