/**
 * Supplier delivery ML readiness audit 2026-11-10, P0 fixes.
 *
 * Real HTTP routes against their own database:
 * - each delivery is a receipt with when the goods arrived, kept apart from
 *   when it was recorded, and lines that point at the PO line
 * - the undelivered remainder of an order can be closed, so it ends
 * - supplier promises are kept as history; the original never changes
 * - order and expected dates that can't be right are refused
 * - supplier lead times keep their history, and rankings use the one that
 *   applied when the order was sent
 * - existing receipts and expected dates are backfilled by the migration
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('supplier delivery history on real PostgreSQL', () => {
  let db, admin, app, request, token, adminId, productId, variantId, supplierId, dates;
  const database = `delivery_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const api = (method, url) => request(app)[method](url).auth(token, { type: 'bearer' });
  const must = (res, ...codes) => {
    if (!codes.includes(res.status)) throw new Error(`${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body.data;
  };
  const dayOffset = (n) => {
    const d = new Date(`${dates.todayStoreDate()}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  async function confirmedPo({ quantity = 10, expectedDate = null, orderDate = null } = {}) {
    const po = must(await api('post', '/po').set('Idempotency-Key', randomUUID()).send({
      supplierId, ...(orderDate ? { orderDate } : {}), ...(expectedDate ? { expectedDate } : {}),
      items: [{ productId, variantId, quantity, costPricePerUnit: 5 }],
    }), 201);
    must(await api('post', `/po/${po.id}/confirm`), 200);
    return must(await api('get', `/po/${po.id}`), 200);
  }
  const receive = (po, qty, extra = {}) => api('post', `/po/${po.id}/receive`).set('Idempotency-Key', randomUUID())
    .send({ items: [{ id: po.items[0].id, quantityReceived: qty }], ...extra });

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
    dates = require('../../server/utils/dates');
    const journal = require('../../server/services/journalService');
    await journal.ensurePeriodsForDate(dates.todayStoreDate());

    const auth = require('../../server/middleware/auth');
    ({ rows: [{ id: adminId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: adminId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [adminId, auth.hashToken(token)]);
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name, is_active) VALUES ('Lamp', true) RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, is_active) VALUES ($1,'LAMP-1',20,5,0,true) RETURNING id`, [productId]));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/po', require('../../server/routes/purchaseOrders'));
    app.use('/suppliers', require('../../server/routes/suppliers'));
    app.use(require('../../server/middleware/errors').errorHandler);
    supplierId = must(await api('post', '/suppliers').send({ name: 'Lighting Co', defaultLeadTimeDays: 4 }), 201).id;
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('a delivery records when the goods arrived, apart from when it was entered', async () => {
    const po = await confirmedPo({ quantity: 10 });
    // Confirmation is "now", so an arrival a minute ago would be before it: back-date the confirmation.
    await db.query(`UPDATE purchase_orders SET confirmed_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [po.id]);
    const arrived = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    must(await receive(po, 4, { deliveredAt: arrived, deliveryNote: 'DN-1182' }), 200);
    must(await receive(po, 6), 200);
    const full = must(await api('get', `/po/${po.id}`), 200);
    expect(full.receipts).toHaveLength(2);
    const [first, second] = full.receipts;
    expect(new Date(first.deliveredAt).toISOString()).toBe(arrived);
    expect(first.deliveredAtSource).toBe('entered');
    expect(first.deliveryNote).toBe('DN-1182');
    expect(new Date(first.recordedAt) - new Date(first.deliveredAt)).toBeGreaterThan(25 * 3600 * 1000);
    expect(second.deliveredAtSource).toBe('defaulted');
    expect(first.lines).toEqual([{ itemId: po.items[0].id, variantId, quantity: 4, expiryDate: null }]);
    // Complete on the day the last goods arrived.
    expect(full.status).toBe('received');
    expect(dates.storeDate(new Date(full.receivedDate))).toBe(dates.todayStoreDate());
  });

  it('the final delivery date is the latest arrival, even when it is entered late', async () => {
    const po = await confirmedPo({ quantity: 2 });
    await db.query(`UPDATE purchase_orders SET confirmed_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [po.id]);
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
    must(await receive(po, 2, { deliveredAt: fiveDaysAgo }), 200);
    const { rows: [row] } = await db.query(`SELECT received_date::text AS d FROM purchase_orders WHERE id = $1`, [po.id]);
    expect(row.d).toBe(dayOffset(-5));
  });

  it('refuses an arrival in the future or before the order was sent', async () => {
    const po = await confirmedPo({ quantity: 3 });
    const future = await receive(po, 1, { deliveredAt: new Date(Date.now() + 3600 * 1000).toISOString() });
    expect(future.status).toBe(400);
    const beforeSent = await receive(po, 1, { deliveredAt: new Date(Date.now() - 86400 * 1000).toISOString() });
    expect(beforeSent.status).toBe(400);
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM purchase_order_receipts WHERE purchase_order_id = $1`, [po.id]);
    expect(n).toBe(0);
  });

  it('closing the remainder ends the order and leaves it owed only for what arrived', async () => {
    const po = await confirmedPo({ quantity: 10 });
    must(await receive(po, 4), 200);
    const before = must(await api('get', `/po/${po.id}`), 200);
    const closed = must(await api('post', `/po/${po.id}/close-remainder`).send({ reason: 'Model discontinued' }), 200);
    expect(closed.status).toBe('received');
    expect(closed.shortCloseReason).toBe('Model discontinued');
    expect(closed.totalCost).toBeCloseTo(before.totalCost * 0.4, 2);
    const full = must(await api('get', `/po/${po.id}`), 200);
    expect(full.items[0]).toMatchObject({ quantityReceived: 4, quantityCancelled: 6, quantityRemaining: 0 });
    // Nothing more can arrive on it.
    expect((await receive(full, 1)).status).toBe(409);
    expect((await api('post', `/po/${po.id}/close-remainder`).send({ reason: 'again' })).status).toBe(409);
  });

  it('a remainder cannot be closed on an order with no deliveries, or that was paid for more than arrived', async () => {
    const untouched = await confirmedPo({ quantity: 5 });
    expect((await api('post', `/po/${untouched.id}/close-remainder`).send({ reason: 'not coming' })).status).toBe(409);
    const paid = await confirmedPo({ quantity: 10 });
    must(await receive(paid, 2), 200);
    await db.query(`UPDATE purchase_orders SET amount_paid = total_cost WHERE id = $1`, [paid.id]);
    const res = await api('post', `/po/${paid.id}/close-remainder`).send({ reason: 'not coming' });
    expect(res.status).toBe(409);
  });

  it('keeps every promised date; the first supplier promise never changes', async () => {
    const po = await confirmedPo({ quantity: 3, expectedDate: dayOffset(5) });
    must(await api('post', `/po/${po.id}/promises`).send({ promisedDate: dayOffset(7), note: 'Supplier email' }), 200);
    const second = must(await api('post', `/po/${po.id}/promises`).send({ promisedDate: dayOffset(12), note: 'Delayed at port' }), 200);
    expect(dates.storeDate(new Date(second.originalPromisedDate))).toBe(dayOffset(7));
    expect(dates.storeDate(new Date(second.promisedDate))).toBe(dayOffset(12));
    const full = must(await api('get', `/po/${po.id}`), 200);
    expect(full.promises.map((p) => [p.source, p.promisedDate])).toEqual([
      ['store_estimate', dayOffset(5)], ['supplier', dayOffset(7)], ['supplier', dayOffset(12)],
    ]);
    // History can't be edited, and the original can't be rewritten.
    await expect(db.query(`UPDATE purchase_order_promises SET promised_date = promised_date + 1 WHERE purchase_order_id = $1`, [po.id]))
      .rejects.toThrow(/append-only/);
    await expect(db.query(`UPDATE purchase_orders SET original_promised_date = original_promised_date + 1 WHERE id = $1`, [po.id]))
      .rejects.toThrow(/cannot change/);
    // A promise before the order date is refused; so is one on a finished order.
    expect((await api('post', `/po/${po.id}/promises`).send({ promisedDate: dayOffset(-30) })).status).toBe(400);
    must(await receive(full, 3), 200);
    expect((await api('post', `/po/${po.id}/promises`).send({ promisedDate: dayOffset(20) })).status).toBe(409);
  });

  it('refuses an order date in the future and an expected date before the order', async () => {
    const base = { supplierId, items: [{ productId, variantId, quantity: 1, costPricePerUnit: 5 }] };
    expect((await api('post', '/po').set('Idempotency-Key', randomUUID()).send({ ...base, orderDate: dayOffset(3) })).status).toBe(400);
    expect((await api('post', '/po').set('Idempotency-Key', randomUUID())
      .send({ ...base, orderDate: dayOffset(-2), expectedDate: dayOffset(-5) })).status).toBe(400);
    const draft = must(await api('post', '/po').set('Idempotency-Key', randomUUID()).send({ ...base, orderDate: dayOffset(-2) }), 201);
    expect((await api('put', `/po/${draft.id}`).send({ expectedDate: dayOffset(-4) })).status).toBe(400);
    const { rows: [row] } = await db.query(`SELECT expected_date FROM purchase_orders WHERE id = $1`, [draft.id]);
    expect(row.expected_date).toBeNull();
  });

  it('keeps the supplier lead-time history, and rankings use the value from when the order was sent', async () => {
    const id = must(await api('post', '/suppliers').send({ name: 'Cable House', defaultLeadTimeDays: 2 }), 201).id;
    const s = must(await api('get', `/suppliers/${id}`), 200);
    must(await api('put', `/suppliers/${id}`).send({ ...s, name: s.name, defaultLeadTimeDays: 30 }), 200);
    const { rows: history } = await db.query(
      `SELECT lead_time_days, changed_by FROM supplier_lead_time_history WHERE supplier_id = $1 ORDER BY effective_from`, [id]);
    expect(history.map((h) => h.lead_time_days)).toEqual([2, 30]);
    expect(history.every((h) => h.changed_by === adminId)).toBe(true);

    // An order sent while the lead time was 2 days, delivered on day 5: late,
    // even though today's 30 days would call it early.
    await db.query(`UPDATE supplier_lead_time_history SET effective_from = NOW() - INTERVAL '20 days'
                     WHERE supplier_id = $1 AND lead_time_days = 2`, [id]);
    const po = must(await api('post', '/po').set('Idempotency-Key', randomUUID()).send({
      supplierId: id, orderDate: dayOffset(-10), items: [{ productId, variantId, quantity: 1, costPricePerUnit: 5 }] }), 201);
    must(await api('post', `/po/${po.id}/confirm`), 200);
    await db.query(`UPDATE purchase_orders SET confirmed_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [po.id]);
    const full = must(await api('get', `/po/${po.id}`), 200);
    must(await receive(full, 1, { deliveredAt: new Date(Date.now() - 5 * 86400 * 1000).toISOString() }), 200);
    const { getSupplierRankings } = require('../../server/services/supplierRankingService');
    const ranking = await getSupplierRankings({ startDate: dayOffset(-30), endDate: dayOffset(0) });
    const row = ranking.delivery.find((r) => r.supplierId === id);
    expect(row.onTime).toBe(0);
  });

  it('the migration backfills receipts from earlier stock movements, and is safe to run again', async () => {
    const po = await confirmedPo({ quantity: 4 });
    must(await receive(po, 4), 200);
    // As if received before migration 065: no receipt rows.
    await db.query(`DELETE FROM purchase_order_receipts WHERE purchase_order_id = $1`, [po.id]);
    const sql = readFileSync(new URL('../../server/db/migrations/065_supplier_delivery_history.sql', import.meta.url), 'utf8');
    await db.query(sql);
    await db.query(sql);
    const { rows } = await db.query(
      `SELECT r.delivered_at_source, l.quantity::float8 AS qty, l.purchase_order_item_id
         FROM purchase_order_receipts r JOIN purchase_order_receipt_lines l ON l.receipt_id = r.id
        WHERE r.purchase_order_id = $1`, [po.id]);
    expect(rows).toEqual([{ delivered_at_source: 'backfilled', qty: 4, purchase_order_item_id: po.items[0].id }]);
  });
});
