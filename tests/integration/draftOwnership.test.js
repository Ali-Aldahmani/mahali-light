/**
 * Round 2, Phase 5 (sales audit SI-02): a draft sale belongs to the cashier
 * who started it. Another cashier can't change, pay or confirm it until they
 * take it over, and the take-over is logged.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('draft ownership on real PostgreSQL', () => {
  let db, admin, app, request, variantId;
  const database = `draft_owner_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  async function cashier() {
    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = 'Cashier'`);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, 'x', $2) RETURNING id`,
      [`c_${randomUUID().slice(0, 8)}`, role.id]);
    const token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, $2, $3)`,
      [u.id, `pc-${randomUUID().slice(0, 6)}`, auth.hashToken(token)]);
    const as = (method, url) => request(app)[method](url).auth(token, { type: 'bearer' });
    return { id: u.id, as };
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
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Owner item') RETURNING id`);
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 0, 0, 20) RETURNING id`, [p.id, randomUUID()]));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use(require('../../server/middleware/errors').errorHandler);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function draftBy(c) {
    const res = await c.as('post', '/invoices').send({ items: [{ variantId, quantity: 1 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.ownerId).toBe(c.id);
    return res.body.data.id;
  }

  it('another cashier can\'t change, pay or confirm someone else\'s draft', async () => {
    const [a, b] = [await cashier(), await cashier()];
    const id = await draftBy(a);

    const edit = await b.as('put', `/invoices/${id}/items`).send({ items: [{ variantId, quantity: 2 }] });
    expect(edit.status).toBe(409);
    expect(edit.body.error.details.reason).toBe('draft_owned_by_other');
    expect((await b.as('post', `/invoices/${id}/payments`).send({ method: 'cash', amount: 1, idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await b.as('post', `/invoices/${id}/confirm`)).status).toBe(409);

    // The owner carries on as normal.
    expect((await a.as('put', `/invoices/${id}/items`).send({ items: [{ variantId, quantity: 2 }] })).status).toBe(200);
    expect((await a.as('post', `/invoices/${id}/confirm`)).status).toBe(200);
  });

  it('taking over moves the draft to the new cashier and is logged', async () => {
    const [a, b] = [await cashier(), await cashier()];
    const id = await draftBy(a);

    const taken = await b.as('post', `/invoices/${id}/take-over`);
    expect(taken.status).toBe(200);
    expect(taken.body.data).toMatchObject({ ownerId: b.id, previousOwnerId: a.id });

    expect((await b.as('post', `/invoices/${id}/confirm`)).status).toBe(200);
    const { rows: [inv] } = await db.query(`SELECT created_by, confirmed_by FROM invoices WHERE id = $1`, [id]);
    expect(inv).toEqual({ created_by: a.id, confirmed_by: b.id });
    const { rows: log } = await db.query(
      `SELECT old_value, new_value FROM activity_log WHERE entity_id = $1 AND action = 'invoice.taken_over'`, [id]);
    expect(log).toHaveLength(1);
    expect(log[0].old_value.ownerId).toBe(a.id);
  });

  it('a confirmed sale can\'t be taken over', async () => {
    const a = await cashier();
    const b = await cashier();
    const id = await draftBy(a);
    await a.as('post', `/invoices/${id}/confirm`);
    expect((await b.as('post', `/invoices/${id}/take-over`)).status).toBe(409);
  });
});
