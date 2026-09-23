/**
 * Stock count vs. concurrent sales regression test.
 *
 * Counts snapshotted system_qty when opened and applied the stored
 * (counted − snapshot) difference at approval — but sales aren't blocked
 * during a count, so every sale made while it was open was deducted twice:
 * snapshot 10, 2 sold (stock 8), shelf counted 8 → approval took it to 6.
 * A line is now compared with the stock held at the moment it was counted,
 * and approval re-bases onto whatever moved afterwards.
 *
 * Drives the real /stock routes; sales go through applyStockMovement (the
 * same path POS confirmation uses). Creates and drops its own database.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('stock count approval re-bases on concurrent sales on real PostgreSQL', () => {
  let db, auth, app, request, admin, stockService;
  let adminToken, productId;
  const database = `stock_count_rebase_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const call = (method, path, body) =>
    request(app)[method](path).auth(adminToken, { type: 'bearer' }).send(body || {});

  async function newVariant(sku, qty) {
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, $2, $2, 100, 40, $3, true) RETURNING id`,
      [productId, sku, qty],
    );
    return v.id;
  }
  const stockOf = async (variantId) =>
    Number((await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [variantId])).rows[0].stock_qty);
  const sell = (variantId, quantity) =>
    stockService.applyStockMovement({ variantId, type: 'sale', quantity, referenceType: 'test_sale' });

  async function openCount(variantId) {
    const res = await call('post', '/stock/counts', { countType: 'partial', variantIds: [variantId] });
    expect(res.status).toBe(201);
    const countId = res.body.data.id;
    const detail = await call('get', `/stock/counts/${countId}`);
    return { countId, itemId: detail.body.data.items[0].id };
  }
  async function saveLine(countId, itemId, fields) {
    const res = await call('put', `/stock/counts/${countId}/items`, { items: [{ id: itemId, ...fields }] });
    expect(res.status).toBe(200);
    return res.body.data.items.find((i) => i.id === itemId);
  }
  async function submitAndApprove(countId) {
    expect((await call('post', `/stock/counts/${countId}/submit`)).status).toBe(200);
    const res = await call('put', `/stock/counts/${countId}/approve`);
    expect(res.status).toBe(200);
    const detail = await call('get', `/stock/counts/${countId}`);
    return detail.body.data;
  }
  async function correctionMovements(countId) {
    const { rows } = await db.query(
      `SELECT quantity FROM stock_movements WHERE reference_type = 'stock_count' AND reference_id = $1`,
      [countId],
    );
    return rows.map((r) => Number(r.quantity));
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
    auth = require('../../server/middleware/auth');
    stockService = require('../../server/services/stockService');

    const { rows: [seededAdmin] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminToken = auth.signToken({ sub: seededAdmin.id });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [seededAdmin.id, auth.hashToken(adminToken)],
    );
    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Bulbs') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('LED Bulb', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    productId = prod.id;

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/stock', require('../../server/routes/stock'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('does not double-deduct sales made between opening the count and counting', async () => {
    const v = await newVariant('SKU-REBASE-1', 10);
    const { countId, itemId } = await openCount(v); // snapshot 10
    await sell(v, 2); // system 8, shelf 8
    const line = await saveLine(countId, itemId, { countedQty: 8 });
    expect(line).toMatchObject({ systemQty: 8, difference: 0 });

    const approved = await submitAndApprove(countId);
    expect(await stockOf(v)).toBe(8); // was 6 before the fix
    expect(await correctionMovements(countId)).toEqual([]);
    expect(approved.discrepancyCount).toBe(0);
  });

  it('keeps sales made after a line was counted', async () => {
    const v = await newVariant('SKU-REBASE-2', 10);
    const { countId, itemId } = await openCount(v);
    await saveLine(countId, itemId, { countedQty: 10 });
    await sell(v, 3); // after counting: shelf and system both 7

    await submitAndApprove(countId);
    expect(await stockOf(v)).toBe(7);
    expect(await correctionMovements(countId)).toEqual([]);
  });

  it('applies only the real shrinkage when sales happen before and after counting', async () => {
    const v = await newVariant('SKU-REBASE-3', 10);
    const { countId, itemId } = await openCount(v);
    await sell(v, 1); // system 9
    const line = await saveLine(countId, itemId, { countedQty: 7 }); // 2 missing
    expect(line).toMatchObject({ systemQty: 9, difference: -2 });
    await sell(v, 1); // system 8, shelf 6

    const approved = await submitAndApprove(countId);
    expect(await stockOf(v)).toBe(6);
    expect(await correctionMovements(countId)).toEqual([-2]);
    const item = approved.items.find((i) => i.id === itemId);
    expect(item).toMatchObject({ systemQty: 9, countedQty: 7, difference: -2, valueImpact: -80 });
  });

  it('re-saving the same quantity or only notes keeps the original count time', async () => {
    const v = await newVariant('SKU-REBASE-4', 5);
    const { countId, itemId } = await openCount(v);
    const first = await saveLine(countId, itemId, { countedQty: 5 });
    await sell(v, 1); // after counting

    const sameQty = await saveLine(countId, itemId, { countedQty: 5, notes: 'second look' });
    expect(sameQty.countedAt).toBe(first.countedAt);
    expect(sameQty.systemQty).toBe(5);
    const notesOnly = await saveLine(countId, itemId, { notes: 'shelf B' });
    expect(notesOnly).toMatchObject({ countedAt: first.countedAt, countedQty: 5, notes: 'shelf B' });

    const withoutNotes = await saveLine(countId, itemId, { countedQty: 5 });
    expect(withoutNotes.notes).toBe('shelf B'); // omitted notes no longer wipe the note

    await submitAndApprove(countId);
    expect(await stockOf(v)).toBe(4); // the post-count sale stands; no correction
  });
});
