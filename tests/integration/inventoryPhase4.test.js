/**
 * Round 2, Phase 4 of the audit fixes, on real PostgreSQL:
 * - INV-003: one barcode, one active product, whichever column or screen
 *   it comes from; scans resolve to that product; clashes that predate
 *   migration 052 stay with the oldest product and are listed by the
 *   reconciliation
 * - INV-007: a stock movement keeps the cost it happened at
 * - INV-006: changing a reorder level updates the low-stock alert at once,
 *   and the hourly sweep repairs alerts a failed check left behind
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('inventory phase 4 on real PostgreSQL', () => {
  let db, admin, app, request, token, userId, invoices;
  const database = `inventory_p4_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const authed = (method, url) => request(app)[method](url).auth(token, { type: 'bearer' });

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
    invoices = require('../../server/services/invoiceService');
    const auth = require('../../server/middleware/auth');
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/products', require('../../server/routes/products'));
    app.use('/variants', require('../../server/routes/variants'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use(require('../../server/middleware/errors').errorHandler);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function product({ barcode, supplierBarcode = null, stock = 0, name = `Item ${randomUUID().slice(0, 6)}` } = {}) {
    const res = await authed('post', '/products').set('Idempotency-Key', randomUUID()).send({
      name, hasVariants: false,
      simple: { barcode, supplierBarcode, sellingPrice: 20, costPrice: 10, openingStock: stock },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const variant = res.body.data.variants[0];
    return { productId: res.body.data.id, variantId: variant.id, name };
  }
  const code = () => `69${Math.floor(Math.random() * 1e11).toString().padStart(11, '0')}`;

  // --- INV-003 ----------------------------------------------------------

  it('INV-003: a supplier barcode can\'t repeat another product\'s barcode, in any case or spacing', async () => {
    const shared = code();
    const a = await product({ barcode: shared });

    const clash = await authed('post', `/products/${a.productId}/variants`).set('Idempotency-Key', randomUUID())
      .send({ supplierBarcode: ` ${shared} `, sellingPrice: 5 });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(new RegExp(`Barcode ${shared} is already used by ${a.name}`));

    const b = await product({ barcode: code() });
    const update = await authed('put', `/products/${b.productId}/variants/${b.variantId}`)
      .send({ supplierBarcode: shared.toLowerCase() });
    expect(update.status).toBe(409);

    const other = await product({ barcode: code(), supplierBarcode: 'abc-777' });
    const caseClash = await authed('post', '/products').set('Idempotency-Key', randomUUID()).send({
      name: 'Case clash', hasVariants: false, simple: { barcode: 'ABC-777', sellingPrice: 1 },
    });
    expect(caseClash.status).toBe(409);
    expect(other).toBeTruthy();
  });

  it('INV-003: a scan finds the one product that owns the code', async () => {
    const supplierCode = code();
    const a = await product({ barcode: code(), supplierBarcode: supplierCode });
    const found = await authed('get', `/variants/barcode/${supplierCode.toLowerCase()}`);
    expect(found.status).toBe(200);
    expect(found.body.data.id).toBe(a.variantId);
  });

  it('INV-003: deactivating a product frees its codes', async () => {
    const shared = code();
    const a = await product({ barcode: shared });
    expect((await authed('put', `/products/${a.productId}`).send({ isActive: false })).status).toBe(200);
    expect((await authed('get', `/variants/barcode/${shared}`)).status).toBe(404);

    const b = await product({ barcode: code(), supplierBarcode: shared });
    expect((await authed('get', `/variants/barcode/${shared}`)).body.data.id).toBe(b.variantId);
    // Reactivating the old product doesn't take the code back.
    expect((await authed('put', `/products/${a.productId}`).send({ isActive: true })).status).toBe(200);
    expect((await authed('get', `/variants/barcode/${shared}`)).body.data.id).toBe(b.variantId);
  });

  it('INV-003: an older clash stays with the first product, keeps both editable, and is reported', async () => {
    const shared = code();
    const first = await product({ barcode: shared, name: `First ${randomUUID().slice(0, 4)}` });
    const second = await product({ barcode: code(), name: `Second ${randomUUID().slice(0, 4)}` });
    // A clash written before migration 052, with the check off.
    await db.query(`ALTER TABLE product_variants DISABLE TRIGGER trg_sync_variant_barcodes`);
    try {
      await db.query(`UPDATE product_variants SET supplier_barcode = $1 WHERE id = $2`, [shared, second.variantId]);
    } finally {
      await db.query(`ALTER TABLE product_variants ENABLE TRIGGER trg_sync_variant_barcodes`);
    }

    // The clashing product can still be edited.
    expect((await authed('put', `/products/${second.productId}/variants/${second.variantId}`)
      .send({ sellingPrice: 25 })).status).toBe(200);
    // Scans and the till's search both go to the first product.
    expect((await authed('get', `/variants/barcode/${shared}`)).body.data.id).toBe(first.variantId);
    const search = await authed('get', `/products/search?q=${shared}&limit=5`);
    expect(search.status).toBe(200);
    expect(search.body.data[0].variantId).toBe(first.variantId);

    const { reconcile } = require('../../scripts/reconcile');
    const results = await reconcile(db.getPool());
    const clashes = results.find((r) => r.id === 'barcode_collisions');
    expect(clashes.error).toBeUndefined();
    expect(clashes.differences.some((d) => d.item.startsWith(shared))).toBe(true);
  });

  // --- INV-007 ----------------------------------------------------------

  it('INV-007: a movement keeps its cost when the product cost changes later', async () => {
    const p = await product({ barcode: code(), stock: 5 });
    const adjust = await authed('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send({
      variantId: p.variantId, adjustmentType: 'add', quantity: 2, reason: 'found',
      note: 'Found in the back store', applyDirectly: true,
    });
    expect(adjust.status).toBe(201);
    await db.query(`UPDATE product_variants SET cost_price = 30 WHERE id = $1`, [p.variantId]);

    const list = await authed('get', `/stock/movements?search=${encodeURIComponent(p.name)}`);
    const adj = list.body.data.find((m) => m.movementType === 'adjustment');
    expect(adj).toMatchObject({ costPrice: 10, valueImpact: 20, costRecorded: true });
    const opening = list.body.data.find((m) => m.movementType === 'opening_stock');
    expect(opening.costPrice).toBe(10);
  });

  it('INV-007: a sale and its cancellation record the booked cost', async () => {
    const p = await product({ barcode: code(), stock: 5 });
    await db.query(`UPDATE product_variants SET selling_price = 0 WHERE id = $1`, [p.variantId]);
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, tax_rate) VALUES ($1, 0) RETURNING id`, [randomUUID()]);
    await db.withTransaction(async (client) => {
      await invoices.replaceItems(client, inv.id, [{ variant_id: p.variantId, quantity: 1, unit_price: 0 }]);
      await invoices.recalculateAndPersistTotals(client, inv.id);
    });
    await db.query(`UPDATE invoice_items SET cost_price_at_time = 12.5 WHERE invoice_id = $1`, [inv.id]);
    await invoices.confirmInvoice({ invoiceId: inv.id, employeeId: userId });
    await invoices.cancelInvoice({ invoiceId: inv.id, employeeId: userId, reason: 'Wrong item scanned' });

    const { rows } = await db.query(
      `SELECT movement_type, unit_cost FROM stock_movements WHERE reference_id = $1 ORDER BY timestamp`, [inv.id]);
    expect(rows.map((r) => [r.movement_type, Number(r.unit_cost)])).toEqual([['sale', 12.5], ['return_in', 12.5]]);
  });

  it('INV-007: movements from before the change show no cost instead of today\'s', async () => {
    const p = await product({ barcode: code(), stock: 3 });
    await db.query(`UPDATE stock_movements SET unit_cost = NULL WHERE variant_id = $1`, [p.variantId]);
    const list = await authed('get', `/stock/movements?search=${encodeURIComponent(p.name)}`);
    expect(list.body.data[0]).toMatchObject({ costRecorded: false, costPrice: null, valueImpact: null });
  });

  // --- INV-006 ----------------------------------------------------------

  const pendingAlerts = async (variantId) =>
    (await db.query(`SELECT * FROM reorder_alerts WHERE variant_id = $1 AND status = 'pending'`, [variantId])).rows;

  it('INV-006: raising or clearing a variant\'s reorder level updates its alert at once', async () => {
    const p = await product({ barcode: code(), stock: 5 });
    expect(await pendingAlerts(p.variantId)).toHaveLength(0);

    expect((await authed('put', `/products/${p.productId}/variants/${p.variantId}`)
      .send({ reorderThreshold: 10 })).status).toBe(200);
    const [alert] = await pendingAlerts(p.variantId);
    expect(alert).toMatchObject({ reorder_point: '10.00' });
    expect(Number(alert.current_stock)).toBe(5);

    expect((await authed('put', `/products/${p.productId}/variants/${p.variantId}`)
      .send({ reorderThreshold: 0 })).status).toBe(200);
    expect(await pendingAlerts(p.variantId)).toHaveLength(0);
  });

  it('INV-006: a product-wide reorder level applies to its variants straight away', async () => {
    const p = await product({ barcode: code(), stock: 2 });
    await db.query(`UPDATE product_variants SET reorder_threshold = NULL WHERE id = $1`, [p.variantId]);
    expect((await authed('put', `/products/${p.productId}`).send({ reorderThreshold: 4 })).status).toBe(200);
    expect(await pendingAlerts(p.variantId)).toHaveLength(1);
  });

  it('INV-006: the hourly sweep repairs alerts a failed check left behind', async () => {
    const low = await product({ barcode: code(), stock: 1 });
    const stocked = await product({ barcode: code(), stock: 50 });
    // Written behind the app's back: a missing alert and a stale one.
    await db.query(`UPDATE product_variants SET reorder_threshold = 3 WHERE id = ANY($1)`, [[low.variantId, stocked.variantId]]);
    await db.query(
      `INSERT INTO reorder_alerts (product_id, variant_id, current_stock, reorder_point, recommended_order_qty)
       VALUES ($1, $2, 1, 3, 5)`, [stocked.productId, stocked.variantId]);

    const emitted = [];
    const io = { to: () => ({ emit: (event, payload) => emitted.push({ event, payload }) }) };
    const result = await require('../../server/jobs/reorderAlertSweep').runReorderAlertSweep(io);

    expect(await pendingAlerts(low.variantId)).toHaveLength(1);
    expect(await pendingAlerts(stocked.variantId)).toHaveLength(0);
    expect(result.resolved).toBeGreaterThanOrEqual(1);
    expect(emitted.some((e) => e.event === 'reorder_alert_created' && e.payload.variantId === low.variantId)).toBe(true);
  });
});
