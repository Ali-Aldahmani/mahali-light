/**
 * Inventory cost batches through HTTP on real PostgreSQL: grouping by cost,
 * receipts kept apart, chosen and automatic batch allocation, overselling and
 * concurrency, and stock coming back to the batches it left.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('inventory cost batches on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, cashier, bank, supplierId;
  const database = `cost_batches_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const must = (res, status) => {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body.data;
  };

  async function user(roleName) {
    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, 'x', $2) RETURNING id`,
      [`u_${randomUUID().slice(0, 8)}`, role.id]);
    const token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, $2, $3)`,
      [u.id, `pc-${randomUUID().slice(0, 6)}`, auth.hashToken(token)]);
    return { id: u.id, as: (method, url) => request(app)[method](url).auth(token, { type: 'bearer' }) };
  }

  async function variant(name, cost = 10) {
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [name]);
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 100, $3, 0) RETURNING id`, [p.id, randomUUID().slice(0, 12), cost]);
    return { productId: p.id, variantId: v.id };
  }

  async function receive(v, quantity, cost) {
    const po = must(await adminUser.as('post', '/purchase-orders').set('Idempotency-Key', randomUUID()).send({
      supplierId, items: [{ productId: v.productId, variantId: v.variantId, quantity, costPricePerUnit: cost }],
    }), 201);
    must(await adminUser.as('post', `/purchase-orders/${po.id}/confirm`), 200);
    const full = must(await adminUser.as('get', `/purchase-orders/${po.id}`), 200);
    must(await adminUser.as('post', `/purchase-orders/${po.id}/receive`).set('Idempotency-Key', randomUUID())
      .send({ items: full.items.map((i) => ({ id: i.id, quantityReceived: i.quantity })) }), 200);
    return po;
  }

  async function batches(v) {
    const { rows } = await db.query(
      `SELECT id, unit_cost::float8 AS cost, qty_on_hand::float8 AS on_hand, qty_quarantined::float8 AS held
         FROM inventory_batches WHERE variant_id = $1 ORDER BY first_received_at, id`, [v.variantId]);
    return rows;
  }

  async function draft(items, as = adminUser) {
    return as.as('post', '/invoices').send({ items });
  }

  async function payAndConfirm(inv, as = adminUser) {
    must(await as.as('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total), bankAccountId: bank,
    }), 201);
    return as.as('post', `/invoices/${inv.id}/confirm`);
  }

  async function sale(items) {
    const inv = must(await draft(items), 201);
    must(await payAndConfirm(inv), 200);
    return inv;
  }

  async function assertInvariant() {
    const { rows } = await db.query(
      `SELECT v.id FROM product_variants v
         LEFT JOIN (SELECT variant_id, SUM(qty_on_hand) AS on_hand, SUM(qty_quarantined) AS held
                      FROM inventory_batches GROUP BY variant_id) b ON b.variant_id = v.id
        WHERE COALESCE(b.on_hand, 0) <> COALESCE(v.stock_qty, 0)
           OR COALESCE(b.held, 0) <> COALESCE(v.quarantine_qty, 0)`);
    expect(rows).toEqual([]);
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
      require('../../server/utils/dates').todayStoreDate());
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
      generatePurchaseOrderPDFSafe: async () => null,
    } };
    ({ rows: [{ id: bank }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, is_default)
       VALUES ('B', 'A', 100000, true) RETURNING id`));
    ({ rows: [{ id: supplierId }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Acme Supply') RETURNING id`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use(require('../../server/middleware/errors').errorHandler);
    adminUser = await user('Admin');
    cashier = await user('Cashier');
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('adds a receipt at a known cost to its group, opens a new group for a new cost, and keeps every receipt', async () => {
    const v = await variant('Grouped Cable');
    const first = await receive(v, 5, 10);
    await receive(v, 3, 10);
    await receive(v, 4, 12);
    expect(await batches(v)).toMatchObject([
      { cost: 10, on_hand: 8, held: 0 },
      { cost: 12, on_hand: 4, held: 0 },
    ]);
    const list = must(await adminUser.as('get', `/stock/batches?variantIds=${v.variantId}`), 200);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ unitCost: 10, qtyOnHand: 8, value: 80, suppliers: ['Acme Supply'] });
    expect(list[0].receipts.map((r) => r.quantity)).toEqual([5, 3]);
    expect(list[0].receipts[0]).toMatchObject({ sourceType: 'purchase_order', sourceId: first.id, unitCost: 10 });
    expect(list[0].batchNumber).toMatch(/^B-\d{6}$/);
    await assertInvariant();
  });

  it('hides batch costs from a cashier, who can still list batches to choose from', async () => {
    const v = await variant('Cashier View');
    await receive(v, 2, 7);
    const list = must(await cashier.as('get', `/stock/batches?variantIds=${v.variantId}`), 200);
    expect(list[0].qtyOnHand).toBe(2);
    expect(list[0]).not.toHaveProperty('unitCost');
    expect(list[0]).not.toHaveProperty('value');
    expect(list[0].receipts[0].unitCost).toBeUndefined();
  });

  it('sells from the batches the cashier chose, across two groups, and records each cost', async () => {
    const v = await variant('Chosen Lamp');
    await receive(v, 5, 10);
    await receive(v, 5, 12);
    const [cheap, dear] = await batches(v);
    const inv = await sale([{ variantId: v.variantId, quantity: 4,
      batchSelection: [{ batchId: dear.id, quantity: 3 }, { batchId: cheap.id, quantity: 1 }] }]);
    expect(await batches(v)).toMatchObject([{ on_hand: 4 }, { on_hand: 2 }]);
    const { rows } = await db.query(
      `SELECT a.quantity::float8 AS qty, a.unit_cost::float8 AS cost
         FROM inventory_batch_allocations a JOIN invoice_items ii ON ii.id = a.invoice_item_id
        WHERE ii.invoice_id = $1 ORDER BY a.unit_cost`, [inv.id]);
    expect(rows).toEqual([{ qty: 1, cost: 10 }, { qty: 3, cost: 12 }]);
    await assertInvariant();
  });

  it('uses the oldest batches when the cashier picks none', async () => {
    const v = await variant('Oldest First');
    await receive(v, 2, 10);
    await receive(v, 5, 12);
    await sale([{ variantId: v.variantId, quantity: 3 }]);
    expect(await batches(v)).toMatchObject([{ cost: 10, on_hand: 0 }, { cost: 12, on_hand: 4 }]);
  });

  it('refuses a choice that does not add up or names another product, when the draft is saved', async () => {
    const v = await variant('Wrong Choice');
    const other = await variant('Other Product');
    await receive(v, 5, 10);
    await receive(other, 5, 10);
    const [mine] = await batches(v);
    const [theirs] = await batches(other);
    const short = await draft([{ variantId: v.variantId, quantity: 3, batchSelection: [{ batchId: mine.id, quantity: 2 }] }]);
    expect(short.status).toBe(400);
    const foreign = await draft([{ variantId: v.variantId, quantity: 1, batchSelection: [{ batchId: theirs.id, quantity: 1 }] }]);
    expect(foreign.status).toBe(400);
  });

  it('refuses to oversell a chosen batch and changes nothing', async () => {
    const v = await variant('Small Batch');
    await receive(v, 2, 10);
    await receive(v, 5, 12);
    const [small] = await batches(v);
    const inv = must(await draft([{ variantId: v.variantId, quantity: 3, batchSelection: [{ batchId: small.id, quantity: 3 }] }]), 201);
    const res = await payAndConfirm(inv);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BIZ_INSUFFICIENT_STOCK');
    expect(await batches(v)).toMatchObject([{ on_hand: 2 }, { on_hand: 5 }]);
    const { rows: [{ stock_qty }] } = await db.query(`SELECT stock_qty::float8 FROM product_variants WHERE id = $1`, [v.variantId]);
    expect(stock_qty).toBe(7);
  });

  it('lets only one of two simultaneous sales take the last units of a batch', async () => {
    const v = await variant('Last Units');
    await receive(v, 3, 10);
    await receive(v, 10, 12);
    const [last] = await batches(v);
    const pick = [{ variantId: v.variantId, quantity: 3, batchSelection: [{ batchId: last.id, quantity: 3 }] }];
    const a = must(await draft(pick), 201);
    const b = must(await draft(pick), 201);
    for (const inv of [a, b]) {
      must(await adminUser.as('post', `/invoices/${inv.id}/payments`).send({
        idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total), bankAccountId: bank,
      }), 201);
    }
    const results = await Promise.all([a, b].map((inv) => adminUser.as('post', `/invoices/${inv.id}/confirm`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await batches(v)).toMatchObject([{ on_hand: 0 }, { on_hand: 10 }]);
    await assertInvariant();
  });

  it('puts a cancelled sale back into the batches it came from', async () => {
    const v = await variant('Cancelled Sale');
    await receive(v, 5, 10);
    await receive(v, 5, 12);
    const [, dear] = await batches(v);
    const inv = await sale([{ variantId: v.variantId, quantity: 2, batchSelection: [{ batchId: dear.id, quantity: 2 }] }]);
    must(await adminUser.as('post', `/invoices/${inv.id}/cancel`).send({ reason: 'Cancelled for the batch test' }), 200);
    expect(await batches(v)).toMatchObject([{ cost: 10, on_hand: 5 }, { cost: 12, on_hand: 5 }]);
    const { rows: [{ returned }] } = await db.query(
      `SELECT SUM(a.returned_qty)::float8 AS returned FROM inventory_batch_allocations a
         JOIN invoice_items ii ON ii.id = a.invoice_item_id WHERE ii.invoice_id = $1`, [inv.id]);
    expect(returned).toBe(2);
    await assertInvariant();
  });

  it('returns goods to their batch, and quarantines defective ones there', async () => {
    const v = await variant('Returned Fan');
    await receive(v, 5, 10);
    await receive(v, 5, 12);
    const [, dear] = await batches(v);
    const inv = await sale([{ variantId: v.variantId, quantity: 4, batchSelection: [{ batchId: dear.id, quantity: 4 }] }]);
    const { rows: [line] } = await db.query(`SELECT id, product_id FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    const ret = must(await adminUser.as('post', '/return-requests').send({
      returnType: 'customer_refund', referenceType: 'invoice', referenceId: inv.id, reason: 'defective',
      requestNote: 'Batch test return of three',
      items: [
        { invoiceItemId: line.id, variantId: v.variantId, productId: line.product_id, quantity: 3, condition: 'defective' },
      ],
      refundPlan: [{ method: 'bank', amount: 315, bankAccountId: bank }],
    }), 201);
    must(await adminUser.as('put', `/return-requests/${ret.id}/approve`).send({}), 200);
    expect(await batches(v)).toMatchObject([
      { cost: 10, on_hand: 5, held: 0 },
      { cost: 12, on_hand: 1, held: 3 },
    ]);
    await assertInvariant();
  });

  it('brings stock recorded outside batches into a batch at the current cost', async () => {
    const v = await variant('Old Stock', 9);
    await db.query(`UPDATE product_variants SET stock_qty = 6 WHERE id = $1`, [v.variantId]);
    await sale([{ variantId: v.variantId, quantity: 1 }]);
    expect(await batches(v)).toMatchObject([{ cost: 9, on_hand: 5 }]);
    await assertInvariant();
  });

  it('keeps journal cost on the store policy whatever batch is sold', async () => {
    const v = await variant('Policy Bulb');
    await receive(v, 5, 10);
    await receive(v, 5, 30); // latest cost is now 30
    const [old] = await batches(v);
    const inv = await sale([{ variantId: v.variantId, quantity: 1, batchSelection: [{ batchId: old.id, quantity: 1 }] }]);
    const { rows: [line] } = await db.query(`SELECT cost_price_at_time::float8 AS cost FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    expect(line.cost).toBe(30);
    const { rows: [alloc] } = await db.query(
      `SELECT a.unit_cost::float8 AS cost FROM inventory_batch_allocations a JOIN invoice_items ii ON ii.id = a.invoice_item_id
        WHERE ii.invoice_id = $1`, [inv.id]);
    expect(alloc.cost).toBe(10);
  });
});
