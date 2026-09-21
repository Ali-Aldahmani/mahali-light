/**
 * Integration tests for remaining trust-boundary rules (setup token, stock set ban).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('trust boundary on real PostgreSQL', () => {
  let db;
  let app;
  let request;
  let variantId;
  let productId;
  let warehouseToken;
  const database = `trust_boundary_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let adminPool;

  beforeAll(async () => {
    Object.assign(process.env, {
      PGHOST: '127.0.0.1',
      PGPORT: process.env.INVOICE_TEST_PG_PORT,
      PGUSER: process.env.INVOICE_TEST_PG_USER || 'postgres',
      PGPASSWORD: process.env.INVOICE_TEST_PG_PASSWORD || '',
      PGDATABASE: database,
    });
    const { Pool } = require('pg');
    adminPool = new Pool({ database: 'postgres' });
    await adminPool.query(`CREATE DATABASE ${database}`);
    createdDatabase = true;

    db = require('../../server/db/postgres');
    await require('../../server/db/migrate').runMigrations();
    await require('../../server/db/seed').run();

    await db.query(
      `UPDATE app_settings SET setup_completed = false, setup_token_hash = NULL, setup_token_issued_at = NULL`,
    );

    const auth = require('../../server/middleware/auth');
    const { rows: roleRows } = await db.query(`SELECT id FROM roles WHERE name = 'Warehouse'`);
    const { rows: whRows } = await db.query(
      `INSERT INTO users (username, password_hash, role_id, is_active)
       VALUES ('tb_warehouse', 'unused', $1, true) RETURNING id`,
      [roleRows[0].id],
    );
    warehouseToken = auth.signToken({ sub: whRows[0].id });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [whRows[0].id, auth.hashToken(warehouseToken)],
    );

    const { rows: cat } = await db.query(
      `INSERT INTO product_categories (name, is_active) VALUES ('TestCat', true) RETURNING id`,
    );
    const { rows: prod } = await db.query(
      `INSERT INTO products (name, category_id, is_active) VALUES ('TestProd', $1, true) RETURNING id`,
      [cat[0].id],
    );
    productId = prod[0].id;
    const { rows: varRows } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, 'TB-1', 10, 5, 100) RETURNING id`,
      [productId],
    );
    variantId = varRows[0].id;

    const express = require('express');
    app = express();
    app.use(express.json());
    app.use('/api/setup', require('../../server/routes/setup'));
    app.use('/api/stock', require('../../server/routes/stock'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({
        code: err.code,
        message: err.message,
      }),
    );
    request = require('supertest')(app);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase && adminPool) {
      await adminPool.query(`DROP DATABASE ${database} WITH (FORCE)`);
      await adminPool.end();
    }
  });

  it('rejects POST /setup/complete without setup token', async () => {
    const res = await request.post('/api/setup/complete').send({
      store: {
        store_name: 'Shop',
        store_address: 'Addr',
        store_phone: '0500000000',
      },
      vat: { vat_enabled: true, vat_rate: 5 },
      network: { mode: 'server' },
      admin: { full_name: 'Owner', username: 'owner1', password: 'secret12' },
    });
    expect(res.status).toBe(403);
  });

  it('completes setup once with valid token then rejects replay', async () => {
    const statusRes = await request.get('/api/setup/status');
    expect(statusRes.status).toBe(200);
    const setupToken = statusRes.body.data.setup_token;
    expect(setupToken).toBeTruthy();

    const completeRes = await request
      .post('/api/setup/complete')
      .set('X-Setup-Token', setupToken)
      .send({
        store: {
          store_name: 'Shop',
          store_address: 'Addr',
          store_phone: '0500000000',
        },
        vat: { vat_enabled: true, vat_rate: 5 },
        network: { mode: 'server' },
      });
    expect(completeRes.status).toBe(201);

    const replay = await request
      .post('/api/setup/complete')
      .set('X-Setup-Token', setupToken)
      .send({
        store: {
          store_name: 'Shop2',
          store_address: 'Addr2',
          store_phone: '0500000001',
        },
        vat: { vat_enabled: true, vat_rate: 5 },
        network: { mode: 'server' },
      });
    expect(replay.status).toBe(409);

    const lockedStatus = await request.get('/api/setup/status');
    expect(lockedStatus.status).toBe(200);
    expect(lockedStatus.body.data.setup_completed).toBe(true);
    expect(lockedStatus.body.data.setup_token).toBeUndefined();
  });

  it('rejects stock adjustment type set', async () => {
    const res = await request
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${warehouseToken}`)
      .send({
        variantId,
        adjustmentType: 'set',
        quantity: 50,
        reason: 'counting_error',
        note: 'Attempting absolute set via API',
      });
    expect(res.status).toBe(400);
  });
});
