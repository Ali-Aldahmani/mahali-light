/**
 * Data readiness 2026-11-12: what can't be rebuilt later is recorded now.
 *
 * Real routes against their own database:
 * - a sale refused for short stock is a lost sale (once, however often retried);
 *   an out-of-stock tap at the till too (repeats within minutes count once)
 * - every selling price change is kept with who made it
 * - changes to a confirmed sale's lines are kept, dated; drafts are not tracked
 * - expiry dates are stored with deliveries, and can't be before arrival
 * - promotions are kept (ended, not deleted); the store calendar and dated
 *   opening hours are stored, with Ramadan and Eid seeded as estimates
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('data capture on real PostgreSQL', () => {
  let db, admin, app, request, token, adminId, productId, variantId, categoryId, supplierId;
  const database = `capture_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const api = (m, url) => request(app)[m](url).auth(token, { type: 'bearer' });
  const must = (res, ...codes) => {
    if (!codes.includes(res.status)) throw new Error(`${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body.data;
  };

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
    await require('../../server/services/journalService').ensurePeriodsForDate(require('../../server/utils/dates').todayStoreDate());
    const auth = require('../../server/middleware/auth');
    ({ rows: [{ id: adminId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: adminId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'t',$2)`, [adminId, auth.hashToken(token)]);
    ({ rows: [{ id: categoryId }] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Lighting') RETURNING id`));
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name, category_id, is_active) VALUES ('Lamp', $1, true) RETURNING id`, [categoryId]));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, is_active) VALUES ($1,'LAMP-9',50,20,2,true) RETURNING id`, [productId]));
    ({ rows: [{ id: supplierId }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('S') RETURNING id`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/products', require('../../server/routes/products'));
    app.use('/po', require('../../server/routes/purchaseOrders'));
    app.use('/store-data', require('../../server/routes/storeData'));
    app.use(require('../../server/middleware/errors').errorHandler);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('a sale refused for short stock is recorded once as a lost sale', async () => {
    const inv = must(await api('post', '/invoices').send({ items: [{ variantId, quantity: 5 }] }), 201);
    const { rows: [bank] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, opening_balance, is_default) VALUES ('B','Main',0,0,true) RETURNING id`);
    must(await api('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'bank', amount: Number(inv.total), bankAccountId: bank.id }), 201);
    const refused = await api('post', `/invoices/${inv.id}/confirm`);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('BIZ_INSUFFICIENT_STOCK');
    expect((await api('post', `/invoices/${inv.id}/confirm`)).status).toBe(422);
    const { rows } = await db.query(`SELECT quantity::float8, available_qty::float8, source, occurrences, recorded_by FROM lost_sales WHERE invoice_id = $1`, [inv.id]);
    // 5 wanted, 2 in stock: 3 could not be sold.
    expect(rows).toEqual([{ quantity: 3, available_qty: 2, source: 'sale_refused', occurrences: 2, recorded_by: adminId }]);
  });

  it('an out-of-stock tap at the till is recorded; repeats within minutes count once', async () => {
    const first = must(await api('post', '/store-data/lost-sales').send({ variantId, source: 'till_out_of_stock' }), 201);
    const again = must(await api('post', '/store-data/lost-sales').send({ variantId, source: 'till_out_of_stock' }), 201);
    expect(again.id).toBe(first.id);
    expect(again.occurrences).toBe(2);
    const list = must(await api('get', '/store-data/lost-sales'), 200);
    expect(list.filter((r) => r.variantId === variantId).map((r) => r.source).sort()).toEqual(['sale_refused', 'till_out_of_stock']);
    expect((await api('post', '/store-data/lost-sales').send({ variantId, quantity: 0 })).status).toBe(400);
  });

  it('every selling price change is kept, with who made it', async () => {
    const res = await api('put', `/products/${productId}/variants/${variantId}`).send({ sellingPrice: 55 });
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      `SELECT selling_price::float8 AS price, previous_price::float8 AS previous, source, changed_by
         FROM variant_price_history WHERE variant_id = $1 ORDER BY effective_from`, [variantId]);
    expect(rows[0]).toMatchObject({ price: 50, source: 'created' });
    expect(rows.at(-1)).toEqual({ price: 55, previous: 50, source: 'change', changed_by: adminId });
    // Saving without a price change adds nothing.
    await api('put', `/products/${productId}/variants/${variantId}`).send({ sellingPrice: 55 });
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM variant_price_history WHERE variant_id = $1`, [variantId]);
    expect(n).toBe(rows.length);
  });

  it('changes to a confirmed sale are kept, dated; a draft is not tracked', async () => {
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, confirmed_at) VALUES ($1,'draft',NULL) RETURNING id`, [`T-${randomUUID().slice(0, 6)}`]);
    const { rows: [line] } = await db.query(
      `INSERT INTO invoice_items (invoice_id, product_id, variant_id, product_name, quantity, unit_price, cost_price_at_time, line_subtotal, line_total)
       VALUES ($1,$2,$3,'Lamp',2,50,20,100,100) RETURNING id`, [inv.id, productId, variantId]);
    await db.query(`UPDATE invoice_items SET quantity = 3, line_total = 150 WHERE id = $1`, [line.id]);
    await db.query(`UPDATE invoices SET status = 'confirmed', confirmed_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [inv.id]);
    const requestId = randomUUID();
    await db.withTransaction(async (client) => {
      await db.setActor(client, adminId, { 'app.edit_request_id': requestId });
      await client.query(`UPDATE invoice_items SET quantity = 1, line_total = 50 WHERE id = $1`, [line.id]);
      await client.query(`UPDATE invoice_items SET cogs_returned = 0 WHERE id = $1`, [line.id]); // not a sale change
    });
    const { rows } = await db.query(
      `SELECT change, old_quantity::float8 AS old_qty, new_quantity::float8 AS new_qty, changed_by, edit_request_id,
              changed_at > NOW() - INTERVAL '1 minute' AS dated_now
         FROM invoice_line_changes WHERE invoice_id = $1`, [inv.id]);
    expect(rows).toEqual([{ change: 'changed', old_qty: 3, new_qty: 1, changed_by: adminId, edit_request_id: requestId, dated_now: true }]);
  });

  it('expiry dates are stored with deliveries and cannot be before arrival', async () => {
    const po = must(await api('post', '/po').set('Idempotency-Key', randomUUID()).send({
      supplierId, items: [{ productId, variantId, quantity: 4, costPricePerUnit: 20 }] }), 201);
    must(await api('post', `/po/${po.id}/confirm`), 200);
    const full = must(await api('get', `/po/${po.id}`), 200);
    const line = full.items[0].id;
    const bad = await api('post', `/po/${po.id}/receive`).set('Idempotency-Key', randomUUID())
      .send({ items: [{ id: line, quantityReceived: 2, expiryDate: '2020-01-01' }] });
    expect(bad.status).toBe(400);
    must(await api('post', `/po/${po.id}/receive`).set('Idempotency-Key', randomUUID())
      .send({ items: [{ id: line, quantityReceived: 2, expiryDate: '2030-06-30' }] }), 200);
    const after = must(await api('get', `/po/${po.id}`), 200);
    expect(after.receipts[0].lines[0].expiryDate).toBe('2030-06-30');
  });

  it('promotions are stored and ended, never deleted', async () => {
    const today = require('../../server/utils/dates').todayStoreDate();
    const promo = must(await api('post', '/store-data/promotions').send({
      name: 'Lighting week', startsOn: today, endsOn: '2099-01-07', discountPercent: 15,
      items: [{ categoryId }, { variantId }] }), 201);
    expect(promo.items).toHaveLength(2);
    expect((await api('post', '/store-data/promotions').send({ name: 'Bad', startsOn: '2026-02-10', endsOn: '2026-02-01', items: [{ variantId }] })).status).toBe(400);
    expect((await api('post', '/store-data/promotions').send({ name: 'Bad', startsOn: today, endsOn: today, items: [{ variantId, productId }] })).status).toBe(400);
    const ended = must(await api('post', `/store-data/promotions/${promo.id}/end`), 200);
    expect(ended.endsOn).toBe(today);
    expect(ended.endedEarlyAt).toBeTruthy();
    expect((await api('post', `/store-data/promotions/${promo.id}/end`)).status).toBe(409);
  });

  it('the store calendar and dated opening hours are stored', async () => {
    const events = must(await api('get', '/store-data/store-calendar?start_date=2027-01-01&end_date=2027-12-31'), 200);
    expect(events.filter((e) => ['ramadan', 'eid'].includes(e.kind)).every((e) => e.estimated)).toBe(true);
    expect(events.map((e) => e.name)).toContain('Ramadan 2027');
    const closed = must(await api('post', '/store-data/store-calendar').send({ kind: 'closed', name: 'Stocktake', startsOn: '2026-12-31', endsOn: '2026-12-31' }), 201);
    const moved = must(await api('put', `/store-data/store-calendar/${closed.id}`).send({ kind: 'closed', name: 'Stocktake', startsOn: '2027-01-02', endsOn: '2027-01-02' }), 200);
    expect(moved.startsOn).toBe('2027-01-02');
    const { rows: [log] } = await db.query(`SELECT old_value FROM activity_log WHERE entity_id = $1 AND action = 'store_calendar.updated'`, [closed.id]);
    expect(JSON.parse(JSON.stringify(log.old_value)).startsOn ?? log.old_value.startsOn).toBe('2026-12-31');

    const week = { 1: { open: '09:00', close: '22:00' }, 2: { open: '09:00', close: '22:00' }, 3: { open: '09:00', close: '22:00' },
      4: { open: '09:00', close: '22:00' }, 5: { open: '14:00', close: '23:00' }, 6: { open: '10:00', close: '23:00' }, 7: null };
    must(await api('post', '/store-data/store-hours').send({ effectiveFrom: '2026-01-01', hours: week }), 201);
    must(await api('post', '/store-data/store-hours').send({ effectiveFrom: '2099-01-01', hours: { ...week, 7: { open: '12:00', close: '20:00' } } }), 201);
    const hours = must(await api('get', '/store-data/store-hours'), 200);
    expect(hours.current.effectiveFrom).toBe('2026-01-01');
    expect(hours.current.hours['7']).toBeNull();
    expect(hours.versions).toHaveLength(2);
    expect((await api('post', '/store-data/store-hours').send({ hours: { 1: { open: '22:00', close: '09:00' } } })).status).toBe(400);
  });
});
