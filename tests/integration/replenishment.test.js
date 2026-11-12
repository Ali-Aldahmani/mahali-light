/**
 * Purchase decision audit 2026-11-12, P0 fixes (services/replenishmentService.js).
 *
 * - stock on hand counts: plenty in stock means wait, not "order 41"
 * - stock on order counts: a confirmed purchase order isn't ordered twice
 * - one calculation: the low-stock alert and the forecast suggestion agree
 * - a closed remainder is no longer on order
 * - confirming a purchase order clears an alert it covers
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('replenishment advice on real PostgreSQL', () => {
  let db, admin, forecast, reorder, app, request, token, supplierId, productId, variantId;
  const database = `replenish_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let n = 0;

  const setStock = (qty, threshold = 0) =>
    db.query(`UPDATE product_variants SET stock_qty = $2, reorder_threshold = $3 WHERE id = $1`, [variantId, qty, threshold]);
  async function openPo(qty, { status = 'confirmed', received = 0, cancelled = 0 } = {}) {
    n += 1;
    const { rows: [po] } = await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, status, confirmed_at) VALUES ($1,$2,$3::varchar, CASE WHEN $3::varchar = 'draft' THEN NULL ELSE NOW() END) RETURNING id`,
      [`PO-T-${n}`, supplierId, status]);
    await db.query(
      `INSERT INTO purchase_order_items (purchase_order_id, product_id, variant_id, quantity, quantity_received, quantity_cancelled, cost_price_per_unit, total_cost)
       VALUES ($1,$2,$3,$4,$5,$6,8,$7)`, [po.id, productId, variantId, qty, received, cancelled, qty * 8]);
    return po.id;
  }
  const clearPos = async () => {
    await db.query(`DELETE FROM purchase_order_items WHERE variant_id = $1`, [variantId]);
    await db.query(`DELETE FROM reorder_alerts WHERE variant_id = $1`, [variantId]);
  };
  const pendingAlert = async () => (await db.query(
    `SELECT recommended_order_qty::float8 AS qty, on_order::float8, inventory_position::float8 AS position
       FROM reorder_alerts WHERE variant_id = $1 AND status = 'pending'`, [variantId])).rows[0] || null;

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
    forecast = require('../../server/services/forecastService');
    reorder = require('../../server/services/reorderService');
    ({ rows: [{ id: supplierId }] } = await db.query(`INSERT INTO suppliers (name, default_lead_time_days) VALUES ('S', 5) RETURNING id`));
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name, is_active, sold_by) VALUES ('Socket', true, 'piece') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, is_active) VALUES ($1,'SK-1',20,8,0,true) RETURNING id`, [productId]));
    // 90 a month for the last three complete months: about 3 a day.
    for (let k = 1; k <= 3; k += 1) {
      const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k);
      n += 1;
      const { rows: [inv] } = await db.query(
        `INSERT INTO invoices (invoice_number, status, confirmed_at, subtotal, taxable_amount, total) VALUES ($1,'confirmed',$2,1800,1800,1800) RETURNING id`,
        [`T-${n}`, `${d.toISOString().slice(0, 8)}15 12:00:00+04`]);
      await db.query(
        `INSERT INTO invoice_items (invoice_id, product_id, variant_id, product_name, quantity, unit_price, cost_price_at_time, line_subtotal, line_total)
         VALUES ($1,$2,$3,'Socket',90,20,8,1800,1800)`, [inv.id, productId, variantId]);
    }
    await forecast.aggregatePendingMonths();

    const auth = require('../../server/middleware/auth');
    const { rows: [{ id: adminId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    token = auth.signToken({ sub: adminId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'t',$2)`, [adminId, auth.hashToken(token)]);
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/po', require('../../server/routes/purchaseOrders'));
    app.use(require('../../server/middleware/errors').errorHandler);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('plenty in stock means wait; none in stock means buy up to the level', async () => {
    await clearPos();
    await setStock(500);
    const full = await forecast.calculateReorderRecommendation(variantId);
    expect(full).toMatchObject({ action: 'wait', recommended_qty: 0, on_order: 0, inventory_position: 500 });
    expect(full.days_of_cover).toBeGreaterThan(150);

    await setStock(0);
    const empty = await forecast.calculateReorderRecommendation(variantId);
    expect(empty.action).toBe('buy');
    expect(empty.recommended_qty).toBe(Math.ceil(empty.order_up_to));
    expect(Number.isInteger(empty.recommended_qty)).toBe(true);
  });

  it('stock already on order is not ordered again', async () => {
    await clearPos();
    await setStock(5);
    await openPo(60);
    const rec = await forecast.calculateReorderRecommendation(variantId);
    expect(rec).toMatchObject({ on_order: 60, inventory_position: 65, action: 'wait', recommended_qty: 0 });

    // A smaller order on the way: buy only the difference.
    await clearPos();
    await openPo(10);
    const short = await forecast.calculateReorderRecommendation(variantId);
    expect(short.action).toBe('buy');
    expect(short.recommended_qty).toBe(Math.ceil(short.order_up_to - 15));
    // Drafts and cancelled orders are not on order.
    await clearPos();
    await openPo(500, { status: 'draft' });
    await openPo(500, { status: 'cancelled' });
    expect((await forecast.calculateReorderRecommendation(variantId)).on_order).toBe(0);
  });

  it('the low-stock alert and the forecast suggestion give the same answer', async () => {
    await clearPos();
    await setStock(5, 10);
    await openPo(3);
    await reorder.checkReorderThreshold(variantId);
    const alert = await pendingAlert();
    // Order up to 10 x 2, less 5 on hand and 3 on order.
    expect(alert).toEqual({ qty: 12, on_order: 3, position: 8 });
    const rec = await forecast.calculateReorderRecommendation(variantId);
    expect(rec).toMatchObject({ basis: 'reorder_level', action: 'buy', recommended_qty: 12 });
    const listed = (await forecast.listReorderRecommendations({ lowStockOnly: true })).find((r) => r.variant_id === variantId);
    expect(listed).toMatchObject({ recommended_qty: 12, on_order: 3, inventory_position: 8 });
  });

  it('a closed remainder is no longer on order', async () => {
    await clearPos();
    await setStock(5, 10);
    await openPo(40, { status: 'received', received: 20, cancelled: 20 });
    await openPo(40, { status: 'partially_received', received: 20, cancelled: 15 });
    const rec = await forecast.calculateReorderRecommendation(variantId);
    expect(rec.on_order).toBe(5);
  });

  it('the list works the advice out from live stock, so a new order counts at once', async () => {
    await clearPos();
    await setStock(5, 10);
    await forecast.calculateReorderRecommendation(variantId);
    expect((await forecast.listReorderRecommendations({ lowStockOnly: true })).some((r) => r.variant_id === variantId)).toBe(true);
    await openPo(50);
    expect((await forecast.listReorderRecommendations({ lowStockOnly: true })).some((r) => r.variant_id === variantId)).toBe(false);
    const one = await forecast.getReorderForVariant(variantId);
    expect(one).toMatchObject({ action: 'wait', on_order: 50 });
  });

  it('confirming a purchase order clears a low-stock alert it covers', async () => {
    await clearPos();
    await setStock(2, 10);
    await reorder.checkReorderThreshold(variantId);
    expect(await pendingAlert()).not.toBeNull();
    const created = await request(app).post('/po').auth(token, { type: 'bearer' }).set('Idempotency-Key', randomUUID())
      .send({ supplierId, items: [{ productId, variantId, quantity: 30, costPricePerUnit: 8 }] });
    expect(created.status).toBe(201);
    // A draft isn't on order yet.
    expect(await pendingAlert()).not.toBeNull();
    const confirmed = await request(app).post(`/po/${created.body.data.id}/confirm`).auth(token, { type: 'bearer' });
    expect(confirmed.status).toBe(200);
    expect(await pendingAlert()).toBeNull();
  });
});
