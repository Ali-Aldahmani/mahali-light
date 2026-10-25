/**
 * Draft invoice rules (invoice audit F13, F23, F24).
 *
 * - F23: a draft save that carries a stale expectedUpdatedAt is refused
 *   (409) instead of overwriting another screen's changes
 * - F13: quantities have at most two decimals, a bound, and whole units for
 *   products sold by the piece; they are rejected, not silently rounded
 * - F24: negative stock is not supported, so the setting always reads
 *   false and can't be turned on
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('draft invoice rules on real PostgreSQL', () => {
  let db, admin, app, request, token;
  const database = `invoice_draft_rules_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const api = () => ({
    get: (url) => request(app).get(url).auth(token, { type: 'bearer' }),
    post: (url, body) => request(app).post(url).auth(token, { type: 'bearer' }).send(body),
    put: (url, body) => request(app).put(url).auth(token, { type: 'bearer' }).send(body),
  });
  async function variant(soldBy = 'piece') {
    const { rows: [p] } = await db.query(`INSERT INTO products (name, sold_by) VALUES ('Cable', $1) RETURNING id`, [soldBy]);
    return (await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 10, 4, 100) RETURNING id`, [p.id, randomUUID()])).rows[0].id;
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
    const { rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/app-settings', require('../../server/routes/appSettings'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('F23 refuses a draft save based on an outdated version', async () => {
    const v = await variant();
    const created = await api().post('/invoices', { items: [{ variantId: v, quantity: 1 }] });
    expect(created.status).toBe(201);
    const { id, updatedAt } = created.body.data;

    // Another screen saves first.
    const first = await api().put(`/invoices/${id}/items`, { items: [{ variantId: v, quantity: 2 }], expectedUpdatedAt: updatedAt });
    expect(first.status).toBe(200);

    const stale = await api().put(`/invoices/${id}/items`, { items: [{ variantId: v, quantity: 5 }], expectedUpdatedAt: updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('RESOURCE_CONFLICT');
    const { rows: [line] } = await db.query(`SELECT quantity FROM invoice_items WHERE invoice_id = $1`, [id]);
    expect(Number(line.quantity)).toBe(2);

    const fresh = await api().put(`/invoices/${id}/items`, {
      items: [{ variantId: v, quantity: 3 }], expectedUpdatedAt: first.body.data.updatedAt,
    });
    expect(fresh.status).toBe(200);
  });

  it('F13 rejects quantities that would be rounded or that break the unit', async () => {
    const piece = await variant('piece');
    const metre = await variant('meter');
    expect((await api().post('/invoices', { items: [{ variantId: metre, quantity: 0.004 }] })).status).toBe(400);
    expect((await api().post('/invoices', { items: [{ variantId: piece, quantity: 1.5 }] })).status).toBe(400);
    expect((await api().post('/invoices', { items: [{ variantId: piece, quantity: 1e7 }] })).status).toBe(400);
    expect((await api().post('/invoices', { items: [{ variantId: metre, quantity: 1.25 }] })).status).toBe(201);
  });

  it('F24 negative stock reads false and cannot be turned on', async () => {
    await db.query(`UPDATE app_settings SET pos_allow_negative_stock = true`);
    expect((await request(app).get('/app-settings/public')).body.data.pos_allow_negative_stock).toBe(false);
    expect((await api().put('/app-settings', { pos_allow_negative_stock: true })).status).toBe(400);

    const v = await variant();
    await db.query(`UPDATE product_variants SET stock_qty = 1 WHERE id = $1`, [v]);
    const draft = await api().post('/invoices', { items: [{ variantId: v, quantity: 3 }] });
    const paid = await api().post(`/invoices/${draft.body.data.id}/payments`, {
      amount: Number(draft.body.data.total), method: 'cash', idempotencyKey: randomUUID(),
    });
    expect(paid.status).toBe(201);
    const confirm = await api().post(`/invoices/${draft.body.data.id}/confirm`, {});
    expect(confirm.status).toBeGreaterThanOrEqual(400);
    expect(confirm.body.code).toBe('BIZ_INSUFFICIENT_STOCK');
  });
});
