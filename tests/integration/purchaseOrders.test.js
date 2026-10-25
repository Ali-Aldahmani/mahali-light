/**
 * Purchase order create/update/confirm regression tests.
 *
 * Before this file existed, POST /api/purchase-orders (the create route,
 * `supplier.purchase_order.create`) 500'd on every single call with items —
 * `purchase_order_items` was inserted via
 *   VALUES ($1,$2,$3,$4,$5,$6,$4*$6)
 * reusing quantity ($4) and cost_price_per_unit ($6) a second time inside a
 * computed total_cost expression. Postgres cannot resolve the `*` operator
 * between two same-numbered, not-yet-typed parameters purely from their
 * other (already-typed) column usages elsewhere in the same VALUES list —
 * it fails with "operator is not unique: unknown * unknown" regardless of
 * what's actually in the table. This was never caught because no test in
 * this repo had ever executed real purchase-order creation against a real
 * Postgres instance. Fixed by casting both operands explicitly
 * ($4::numeric*$6::numeric).
 *
 * Also covers a related updateSchema bug: `createSchema.partial({
 * supplierId: true })` only made `supplierId` optional, leaving the
 * required `items` array (and everything else) mandatory on PUT /:id too —
 * so editing just a draft PO's notes 400'd unless a full items array was
 * resent. Fixed to `createSchema.partial()` (every field optional),
 * matching the controller's own `if (body.items)` / `COALESCE($n, col)`
 * handling, which already assumed partial updates were supported.
 *
 * Creates and drops its own database on an explicitly selected local test
 * server, mirroring tests/integration/invoiceIntegrity.test.js.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('purchase order create/update/confirm on real PostgreSQL', () => {
  let db, auth, app, request, admin;
  let adminToken, adminId, productId, variantId, supplierId;
  const database = `po_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

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
    const { rows: seededAdmin } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminId = seededAdmin[0].id;
    adminToken = auth.signToken({ sub: adminId });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [adminId, auth.hashToken(adminToken)],
    );

    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Cables') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('Test Wire', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    productId = prod.id;
    const { rows: [variant] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, 'SKU-PO-TEST', 'BC-PO-TEST', 100, 60, 0, true) RETURNING id`,
      [productId],
    );
    variantId = variant.id;
    const { rows: [supplier] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Test Supplier') RETURNING id`);
    supplierId = supplier.id;

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  let poId;

  it('creates a draft PO with items (regression: ambiguous $4*$6 operator)', async () => {
    const res = await request(app)
      .post('/purchase-orders')
      .auth(adminToken, { type: 'bearer' })
      .send({
        supplierId,
        items: [{ productId, variantId, quantity: 5, costPricePerUnit: 60 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    poId = res.body.data.id;

    const { rows } = await db.query(
      `SELECT quantity, cost_price_per_unit, total_cost FROM purchase_order_items WHERE purchase_order_id = $1`,
      [poId],
    );
    expect(Number(rows[0].total_cost)).toBe(300); // 5 * 60, computed server-side
  });

  it('updates a field-only change without resending items (regression: partial() schema)', async () => {
    const res = await request(app)
      .put(`/purchase-orders/${poId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ notes: 'updated notes only' });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('updated notes only');
  });

  it('a paid draft keeps its supplier and cannot drop below what was paid (Phase 4)', async () => {
    const put = (id, body) => request(app).put(`/purchase-orders/${id}`).auth(adminToken, { type: 'bearer' }).send(body);
    const created = await request(app).post('/purchase-orders').auth(adminToken, { type: 'bearer' })
      .send({ supplierId, items: [{ productId, variantId, quantity: 2, costPricePerUnit: 60 }] });
    const draftId = created.body.data.id;
    await require('../../server/services/supplierPaymentService').addPayment({
      poId: draftId, amount: 100, method: 'cheque', employeeId: adminId,
    });
    const { rows: [other] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Other Supplier') RETURNING id`);

    expect((await put(draftId, { supplierId: other.id })).status).toBe(409);
    expect((await put(draftId, { items: [{ productId, variantId, quantity: 1, costPricePerUnit: 60 }] })).status).toBe(409);
    const { rows: [unchanged] } = await db.query(
      `SELECT supplier_id, amount_paid FROM purchase_orders WHERE id = $1`, [draftId]);
    expect(unchanged.supplier_id).toBe(supplierId);

    const grown = await put(draftId, { items: [{ productId, variantId, quantity: 3, costPricePerUnit: 60 }] });
    expect(grown.status).toBe(200);
    const { rows: [after] } = await db.query(
      `SELECT payment_status, balance_due FROM purchase_orders WHERE id = $1`, [draftId]);
    expect(after.payment_status).toBe('partial');
    expect(Number(after.balance_due)).toBeGreaterThan(0);
  });

  it('confirms the draft PO', async () => {
    const res = await request(app)
      .post(`/purchase-orders/${poId}/confirm`)
      .auth(adminToken, { type: 'bearer' })
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
    // Lead-time clock starts here, not at draft creation (migration 035).
    expect(res.body.data.confirmedAt).toBeTruthy();
    const { rows } = await db.query(`SELECT confirmed_at FROM purchase_orders WHERE id = $1`, [poId]);
    expect(Date.now() - new Date(rows[0].confirmed_at).getTime()).toBeLessThan(60_000);
  });

  it('rejects editing a confirmed PO (409, not silently applied)', async () => {
    const res = await request(app)
      .put(`/purchase-orders/${poId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({ notes: 'should not apply' });
    expect(res.status).toBe(409);
  });

  it('rejects deleting a confirmed PO (409)', async () => {
    const res = await request(app)
      .delete(`/purchase-orders/${poId}`)
      .auth(adminToken, { type: 'bearer' })
      .send({});
    expect(res.status).toBe(409);
  });
  it('cancelling keeps the PO, and is refused once something is received or paid (PO F04)', async () => {
    const post = (url, body) => request(app).post(url).auth(adminToken, { type: 'bearer' }).send(body || {});
    const newPo = async () => (await post('/purchase-orders', {
      supplierId, items: [{ productId, variantId, quantity: 2, costPricePerUnit: 60 }],
    })).body.data.id;

    // A draft: the old DELETE now cancels instead of erasing it.
    const draftId = await newPo();
    const del = await request(app).delete(`/purchase-orders/${draftId}`).auth(adminToken, { type: 'bearer' });
    expect(del.status).toBe(200);
    const { rows: [kept] } = await db.query(
      `SELECT status, cancelled_by, (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = $1)::int AS items
         FROM purchase_orders WHERE id = $1`, [draftId]);
    expect(kept).toMatchObject({ status: 'cancelled', cancelled_by: adminId, items: 1 });
    expect((await post(`/purchase-orders/${draftId}/cancel`)).status).toBe(409);

    // A confirmed PO with nothing received or paid can be cancelled.
    const confirmedId = await newPo();
    expect((await post(`/purchase-orders/${confirmedId}/confirm`)).status).toBe(200);
    const cancelled = await post(`/purchase-orders/${confirmedId}/cancel`, { reason: 'Supplier out of stock' });
    expect(cancelled.status).toBe(200);
    const { rows: [c] } = await db.query(`SELECT cancel_reason FROM purchase_orders WHERE id = $1`, [confirmedId]);
    expect(c.cancel_reason).toBe('Supplier out of stock');

    // Paid, or with goods received: refused.
    const paidId = await newPo();
    await post(`/purchase-orders/${paidId}/confirm`);
    await require('../../server/services/supplierPaymentService').addPayment({
      poId: paidId, amount: 10, method: 'cheque', employeeId: adminId,
    });
    expect((await post(`/purchase-orders/${paidId}/cancel`)).status).toBe(409);

    const receivedId = await newPo();
    await post(`/purchase-orders/${receivedId}/confirm`);
    const { rows: [item] } = await db.query(`SELECT id FROM purchase_order_items WHERE purchase_order_id = $1`, [receivedId]);
    const rec = await request(app).post(`/purchase-orders/${receivedId}/receive`).auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ items: [{ id: item.id, quantityReceived: 1 }] });
    expect(rec.status).toBe(200);
    expect((await post(`/purchase-orders/${receivedId}/cancel`)).status).toBe(409);
  });
});
