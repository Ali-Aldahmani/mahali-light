/**
 * Whole-repo review, inventory batch, through HTTP on real PostgreSQL: requests
 * need a second person, cost stays with product.view_cost, supplier returns are
 * capped by what was received, deactivation can't sidestep its permission, and
 * manual warranties must agree with the sale they name.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('inventory review fixes on real PostgreSQL', () => {
  let db, admin, app, request, variantId, productId, otherProductId, supplierId, adminUser, manager, warehouse, cashier;
  const database = `review_inv_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

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
      generatePurchaseOrderPDFSafe: async () => null,
    } };
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name) VALUES ('Stock item') RETURNING id`));
    ({ rows: [{ id: otherProductId }] } = await db.query(`INSERT INTO products (name) VALUES ('Other item') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 50, 20, 100) RETURNING id`, [productId, randomUUID()]));
    ({ rows: [{ id: supplierId }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Acme') RETURNING id`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/stock', require('../../server/routes/stock'));
    app.use('/products', require('../../server/routes/products'));
    app.use('/suppliers', require('../../server/routes/suppliers'));
    app.use('/supplier-returns', require('../../server/routes/supplierReturns'));
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use('/warranties', require('../../server/routes/warranties'));
    app.use(require('../../server/middleware/errors').errorHandler);

    adminUser = await user('Admin');
    manager = await user('Manager');
    warehouse = await user('Warehouse');
    cashier = await user('Cashier');
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function receivedPo(quantity = 5) {
    const created = await manager.as('post', '/purchase-orders').set('Idempotency-Key', randomUUID()).send({
      supplierId, items: [{ variantId, productId, quantity, costPricePerUnit: 20 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id;
    expect((await manager.as('post', `/purchase-orders/${id}/confirm`)).status).toBe(200);
    const full = await manager.as('get', `/purchase-orders/${id}`);
    const received = await manager.as('post', `/purchase-orders/${id}/receive`).set('Idempotency-Key', randomUUID())
      .send({ items: full.body.data.items.map((it) => ({ id: it.id, quantityReceived: it.quantity })) });
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    return id;
  }

  const supplierReturn = (purchaseOrderId, quantity) => manager.as('post', '/supplier-returns')
    .set('Idempotency-Key', randomUUID()).send({
      supplierId, purchaseOrderId, reason: 'defective',
      items: [{ variantId, productId, quantity, condition: 'damaged' }],
    });

  it('a Manager cannot approve their own adjustment request', async () => {
    const filed = await manager.as('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send({
      variantId, adjustmentType: 'add', quantity: 1, reason: 'found', note: 'Found one on the shelf',
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const own = await manager.as('put', `/stock/adjustments/${filed.body.data.id}/approve`);
    expect(own.status, JSON.stringify(own.body)).toBe(403);
    expect((await adminUser.as('put', `/stock/adjustments/${filed.body.data.id}/approve`)).status).toBe(200);
  });

  it('a retried direct removal of the last units returns the first result', async () => {
    const { rows: [{ id: lastVariant }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 10, 5, 5) RETURNING id`, [productId, randomUUID()]);
    const key = randomUUID();
    const send = () => manager.as('post', '/stock/adjustments').set('Idempotency-Key', key).send({
      variantId: lastVariant, adjustmentType: 'remove', quantity: 5, reason: 'damaged',
      note: 'All five were broken', applyDirectly: true,
    });
    expect((await send()).status).toBe(201);
    const retry = await send();
    expect(retry.status, JSON.stringify(retry.body)).toBeLessThan(300);
    const { rows: [v] } = await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [lastVariant]);
    expect(Number(v.stock_qty)).toBe(0);
  });

  it('product history hides cost from a user without view_cost', async () => {
    const edited = await manager.as('put', `/products/${productId}/variants/${variantId}`).send({ costPrice: 21 });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const asCashier = await cashier.as('get', `/products/${productId}/history`);
    expect(asCashier.status).toBe(200);
    expect(JSON.stringify(asCashier.body)).not.toContain('"costPrice":21');
    const asManager = await manager.as('get', `/products/${productId}/history`);
    expect(JSON.stringify(asManager.body)).toContain('"costPrice":21');
  });

  it('Warehouse sees suppliers and returns but not what they cost, and no PO PDF', async () => {
    const po = await receivedPo();
    const asWarehouse = await warehouse.as('get', '/suppliers');
    expect(asWarehouse.status).toBe(200);
    expect(asWarehouse.body.data[0].totalSpent).toBeUndefined();
    const list = await warehouse.as('get', `/suppliers/${supplierId}/purchase-orders`);
    expect(list.body.data[0].totalCost).toBeUndefined();
    expect((await warehouse.as('get', `/purchase-orders/${po}/pdf`)).status).toBe(403);
    const asManager = await manager.as('get', `/suppliers/${supplierId}/purchase-orders`);
    expect(typeof asManager.body.data[0].totalCost).toBe('number');
  });

  it('a supplier return is capped by what that PO received', async () => {
    const po = await receivedPo(5);
    expect((await supplierReturn(po, 6)).status).toBe(400);
    const first = await supplierReturn(po, 3);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await supplierReturn(po, 3)).status).toBe(400);
    expect((await supplierReturn(po, 2)).status).toBe(201);
  });

  it('paying what is left after a return marks the PO paid', async () => {
    const po = await receivedPo(5);
    expect((await supplierReturn(po, 2)).status).toBe(201);
    const before = await manager.as('get', `/purchase-orders/${po}`);
    const owed = Number(before.body.data.balanceDue);
    const { rows: [account] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance) VALUES ('PO bank', 'Main', 100000) RETURNING id`);
    const paid = await manager.as('post', `/purchase-orders/${po}/payments`).set('Idempotency-Key', randomUUID())
      .send({ amount: owed, paymentMethod: 'bank_transfer', bankAccountId: account.id });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const { rows: [row] } = await db.query(`SELECT payment_status, balance_due FROM purchase_orders WHERE id = $1`, [po]);
    expect(row.payment_status).toBe('paid');
    expect(Number(row.balance_due)).toBe(0);
  });

  it('a PO line cannot pair a variant with another product', async () => {
    const res = await manager.as('post', '/purchase-orders').set('Idempotency-Key', randomUUID()).send({
      supplierId, items: [{ variantId, productId: otherProductId, quantity: 1, costPricePerUnit: 20 }],
    });
    expect(res.status).toBe(400);
  });

  it('an edit cannot deactivate a product or variant without product.delete', async () => {
    expect((await manager.as('put', `/products/${productId}`).send({ isActive: false })).status).toBe(403);
    expect((await manager.as('put', `/products/${productId}/variants/${variantId}`).send({ isActive: false })).status).toBe(403);
  });

  it('a manual warranty must agree with the invoice it names', async () => {
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, subtotal, total) VALUES ($1, 'draft', 0, 0) RETURNING id`,
      [`INV-${randomUUID().slice(0, 8)}`]);
    const res = await cashier.as('post', '/warranties').send({
      productId, invoiceId: inv.id, startDate: '2026-11-01', durationMonths: 12,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });
});
