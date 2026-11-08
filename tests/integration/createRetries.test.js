/**
 * The remaining create commands are safe to retry (idempotency audit,
 * lower-risk creates): the same request key sent twice records one PO,
 * supplier return, return request, manual journal entry, bill and warranty
 * claim, and the retry gets the first result back.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('create retries on real PostgreSQL', () => {
  let db, admin, app, request, token, userId, productId, variantId, supplierId;
  const database = `create_retries_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const post = (url, body, key) =>
    request(app).post(url).auth(token, { type: 'bearer' }).set('Idempotency-Key', key).send(body);
  const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
  async function twice(url, body) {
    const key = randomUUID();
    const first = await post(url, body, key);
    const second = await post(url, body, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBeLessThan(300);
    expect(second.body.data.id).toBe(first.body.data.id);
    return first.body.data;
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
    const auth = require('../../server/middleware/auth');
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name) VALUES ('Socket') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 10, 4, 20) RETURNING id`, [productId, randomUUID()]));
    ({ rows: [{ id: supplierId }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Sup') RETURNING id`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use('/supplier-returns', require('../../server/routes/supplierReturns'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/finance', require('../../server/routes/finance'));
    app.use('/bills', require('../../server/routes/bills'));
    app.use('/warranty-claims', require('../../server/routes/warrantyClaims'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('purchase order', async () => {
    const po = await twice('/purchase-orders', { supplierId, items: [{ productId, variantId, quantity: 2, costPricePerUnit: 4 }] });
    expect(await count(`SELECT COUNT(*) AS n FROM purchase_orders WHERE supplier_id = $1`, [supplierId])).toBe(1);
    expect(po.id).toBeTruthy();
  });

  it('supplier return moves the stock out once', async () => {
    await twice('/supplier-returns', {
      supplierId, reason: 'defective', items: [{ productId, variantId, quantity: 1, condition: 'defective' }],
    });
    expect(await count(`SELECT COUNT(*) AS n FROM supplier_returns`)).toBe(1);
    expect(Number((await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [variantId])).rows[0].stock_qty)).toBe(19);
  });

  it('return request', async () => {
    const { rows: [po] } = await db.query(`SELECT id FROM purchase_orders LIMIT 1`);
    // A return is capped by what the order received.
    await db.query(`UPDATE purchase_orders SET status = 'received' WHERE id = $1`, [po.id]);
    await db.query(`UPDATE purchase_order_items SET quantity_received = quantity WHERE purchase_order_id = $1`, [po.id]);
    await twice('/return-requests', {
      returnType: 'supplier_return', referenceType: 'purchase_order', referenceId: po.id, supplierId,
      reason: 'defective', requestNote: 'Two units arrived cracked.',
      items: [{ variantId, quantity: 1, condition: 'defective' }],
    });
    expect(await count(`SELECT COUNT(*) AS n FROM return_requests`)).toBe(1);
  });

  it('manual journal entry', async () => {
    const { rows: [cash] } = await db.query(`SELECT id FROM chart_of_accounts WHERE code = '1001'`);
    const { rows: [eq] } = await db.query(`SELECT id FROM chart_of_accounts WHERE code = '3001'`);
    const date = require('../../server/utils/dates').todayStoreDate();
    await twice('/finance/journal', {
      date, description: 'Owner float',
      lines: [{ accountId: cash.id, debit: 50 }, { accountId: eq.id, credit: 50 }],
    });
    expect(await count(`SELECT COUNT(*) AS n FROM journal_entries WHERE description = 'Owner float'`)).toBe(1);
  });

  it('bill', async () => {
    await twice('/bills', { name: 'Internet', amount: 300, frequency: 'monthly', startDate: '2026-11-01' });
    expect(await count(`SELECT COUNT(*) AS n FROM bills WHERE name = 'Internet'`)).toBe(1);
  });

  it('warranty claim', async () => {
    const { rows: [w] } = await db.query(
      `INSERT INTO warranties (warranty_number, product_id, variant_id, start_date, end_date, duration_months)
       VALUES ($1, $2, $3, CURRENT_DATE - 1, CURRENT_DATE + 300, 12) RETURNING id`, [`W-${randomUUID()}`, productId, variantId]);
    await twice('/warranty-claims', { warrantyId: w.id, issueDescription: 'No power' });
    expect(await count(`SELECT COUNT(*) AS n FROM warranty_claims WHERE warranty_id = $1`, [w.id])).toBe(1);
  });
});
