/**
 * Weighted average valuation and receipt layers through HTTP on real
 * PostgreSQL. After every step the ledger's inventory account (1004) must
 * equal the book value, the inventory valuation report must agree, and every
 * batch and receipt quantity must add up.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('inventory valuation on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, bank, valuation, legacyVariant;
  let s1, s2, product, variant;
  const database = `inventory_valuation_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const must = (res, ...status) => {
    expect(status, JSON.stringify(res.body)).toContain(res.status);
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

  async function receive(supplierId, quantity, cost) {
    const po = must(await adminUser.as('post', '/purchase-orders').set('Idempotency-Key', randomUUID()).send({
      supplierId, items: [{ productId: product, variantId: variant, quantity, costPricePerUnit: cost }],
    }), 201);
    must(await adminUser.as('post', `/purchase-orders/${po.id}/confirm`), 200);
    const full = must(await adminUser.as('get', `/purchase-orders/${po.id}`), 200);
    must(await adminUser.as('post', `/purchase-orders/${po.id}/receive`).set('Idempotency-Key', randomUUID())
      .send({ items: full.items.map((i) => ({ id: i.id, quantityReceived: i.quantity })) }), 200);
    return po;
  }

  async function sale(quantity, batchSelection = null) {
    const inv = must(await adminUser.as('post', '/invoices').send({
      items: [{ variantId: variant, quantity, ...(batchSelection ? { batchSelection } : {}) }],
    }), 201);
    must(await adminUser.as('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total), bankAccountId: bank,
    }), 201);
    must(await adminUser.as('post', `/invoices/${inv.id}/confirm`), 200);
    const { rows: [line] } = await db.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    return { inv, line };
  }

  async function customerReturn(s, quantity, condition = 'good', replacement = null) {
    const r = must(await adminUser.as('post', '/return-requests').send({
      returnType: replacement ? 'customer_replace' : 'customer_refund',
      referenceType: 'invoice', referenceId: s.inv.id, reason: 'defective', requestNote: 'Valuation test return',
      items: [{ invoiceItemId: s.line.id, variantId: variant, productId: product, quantity, condition }],
      refundPlan: replacement ? [] : [{ method: 'bank', amount: 105 * quantity, bankAccountId: bank }],
      ...(replacement ? { replacementPlan: { items: replacement } } : {}),
    }), 201);
    must(await adminUser.as('put', `/return-requests/${r.id}/approve`).send({}), 200);
  }

  async function receipts() {
    const { rows } = await db.query(
      `SELECT r.id, b.unit_cost::float8 AS cost, r.quantity::float8 AS received, r.qty_on_hand::float8 AS on_hand,
              r.qty_quarantined::float8 AS held, r.qty_sold::float8 AS sold, r.qty_returned::float8 AS returned,
              r.qty_out_other::float8 AS out_other, s.name AS supplier
         FROM inventory_batch_receipts r JOIN inventory_batches b ON b.id = r.batch_id
         LEFT JOIN suppliers s ON s.id = r.supplier_id
        WHERE b.variant_id = $1 ORDER BY r.received_at, r.id`, [variant]);
    return rows;
  }

  async function assertReconciled(label) {
    const rec = await valuation.getReconciliation();
    const failed = rec.checks.filter((c) => !c.ok).map((c) => `${c.key}: ${JSON.stringify(c.issues.slice(0, 2))}`);
    expect({ label, difference: rec.difference, failed }).toEqual({ label, difference: 0, failed: [] });
    expect(rec.ledgerInventory).toBe(rec.bookValue);
    const report = must(await adminUser.as('get', '/reports/inventory_valuation'), 200);
    expect(report.totals.cost_value, `${label}: valuation report`).toBeCloseTo(rec.ledgerInventory, 2);
    return rec;
  }

  const book = async () => {
    const { rows: [v] } = await db.query(
      `SELECT stock_qty::float8 AS stock, quarantine_qty::float8 AS held, inventory_value::float8 AS value,
              cost_price::float8 AS cost, last_purchase_cost::float8 AS last FROM product_variants WHERE id = $1`, [variant]);
    return v;
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
    await require('../../server/services/journalService').ensurePeriodsForDate(
      require('../../server/utils/dates').todayStoreDate());
    valuation = require('../../server/services/inventoryValuationService');
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
      generatePurchaseOrderPDFSafe: async () => null,
    } };
    ({ rows: [{ id: bank }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, is_default)
       VALUES ('B', 'A', 100000, true) RETURNING id`));
    ({ rows: [{ id: s1 }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('First Supplier') RETURNING id`));
    ({ rows: [{ id: s2 }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Second Supplier') RETURNING id`));
    ({ rows: [{ id: product }] } = await db.query(`INSERT INTO products (name) VALUES ('Valued Lamp') RETURNING id`));
    ({ rows: [{ id: variant }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, 'VL-1', 100, 0, 0) RETURNING id`, [product]));
    // Stock from before the policy: book value set by migration 061, never in the ledger.
    const { rows: [p2] } = await db.query(`INSERT INTO products (name) VALUES ('Legacy Fan') RETURNING id`);
    ({ rows: [{ id: legacyVariant }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, inventory_value)
       VALUES ($1, 'LF-1', 50, 25, 4, 100) RETURNING id`, [p2.id]));
    await db.query(
      `WITH b AS (INSERT INTO inventory_batches (product_id, variant_id, unit_cost, qty_on_hand) VALUES ($1, $2, 25, 4) RETURNING id)
       INSERT INTO inventory_batch_receipts (batch_id, source_type, quantity, unit_cost, qty_on_hand)
       SELECT id, 'opening_balance', 4, 25, 4 FROM b`, [p2.id, legacyVariant]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use('/supplier-returns', require('../../server/routes/supplierReturns'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use('/products', require('../../server/routes/products'));
    app.use('/reports', require('../../server/routes/reports'));
    app.use('/finance', require('../../server/routes/finance'));
    app.use(require('../../server/middleware/errors').errorHandler);
    adminUser = await user('Admin');
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('books the gap left from before the policy once, against retained earnings', async () => {
    const before = await valuation.getReconciliation();
    expect(before.difference).toBe(-100);
    const row = await valuation.ensureOpeningCorrection();
    expect(Number(row.difference)).toBe(100);
    const { rows: lines } = await db.query(
      `SELECT a.code, jl.debit::float8 AS debit, jl.credit::float8 AS credit
         FROM journal_lines jl JOIN chart_of_accounts a ON a.id = jl.account_id
        WHERE jl.journal_entry_id = $1 ORDER BY a.code`, [row.journal_entry_id]);
    expect(lines).toEqual([{ code: '1004', debit: 100, credit: 0 }, { code: '3002', debit: 0, credit: 100 }]);
    const again = await valuation.ensureOpeningCorrection();
    expect(again.id).toBe(row.id);
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE reference_type = 'inventory_valuation'`);
    expect(n).toBe(1);
    await assertReconciled('after the opening correction');
  });

  it('keeps receipts at the same cost apart inside one cost group, and averages the books', async () => {
    await receive(s1, 10, 10);
    await receive(s1, 10, 10);
    await receive(s2, 10, 12);
    expect(await receipts()).toMatchObject([
      { cost: 10, received: 10, on_hand: 10, supplier: 'First Supplier' },
      { cost: 10, received: 10, on_hand: 10, supplier: 'First Supplier' },
      { cost: 12, received: 10, on_hand: 10, supplier: 'Second Supplier' },
    ]);
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM inventory_batches WHERE variant_id = $1`, [variant]);
    expect(n).toBe(2);
    // (100 + 100 + 120) / 30
    expect(await book()).toMatchObject({ stock: 30, value: 320, cost: 10.67, last: 12 });
    await assertReconciled('after three receipts');
  });

  it('sells across receipts oldest first, at the average, whatever group the cashier picks', async () => {
    const [ten] = (await db.query(`SELECT id FROM inventory_batches WHERE variant_id = $1 AND unit_cost = 10`, [variant])).rows;
    const s = await sale(12, [{ batchId: ten.id, quantity: 12 }]);
    expect(Number(s.line.cogs_value)).toBe(128.04); // 12 x 10.67
    expect(await receipts()).toMatchObject([
      { received: 10, on_hand: 0, sold: 10 },
      { received: 10, on_hand: 8, sold: 2 },
      { received: 10, on_hand: 10, sold: 0 },
    ]);
    const { rows: alloc } = await db.query(
      `SELECT quantity::float8 AS qty, unit_cost::float8 AS cost FROM inventory_batch_allocations
        WHERE invoice_item_id = $1 ORDER BY created_at, id`, [s.line.id]);
    expect(alloc).toEqual([{ qty: 10, cost: 10 }, { qty: 2, cost: 10 }]);
    await assertReconciled('after a sale across two receipts');
    globalThis.__valuationSale = s;
  });

  it('takes returns back at the value they left at, to the receipts they came from', async () => {
    const s = globalThis.__valuationSale;
    await customerReturn(s, 3, 'good');
    // Back to the newest allocation first: 2 to the second receipt, 1 to the first.
    expect(await receipts()).toMatchObject([
      { on_hand: 1, sold: 10, returned: 1 },
      { on_hand: 10, sold: 2, returned: 2 },
      { on_hand: 10, sold: 0, returned: 0 },
    ]);
    const { rows: [line] } = await db.query(`SELECT cogs_returned::float8 AS back FROM invoice_items WHERE id = $1`, [s.line.id]);
    expect(line.back).toBe(32.01); // 128.04 x 3 / 12
    await customerReturn(s, 1, 'defective');
    expect((await book()).held).toBe(1);
    await assertReconciled('after a good and a defective return');
  });

  it('handles an exchange, damage, a write-off and a supplier return without a gap', async () => {
    const s = await sale(2);
    await customerReturn(s, 1, 'good', [{ variantId: variant, quantity: 1 }]);
    await assertReconciled('after an exchange');
    must(await adminUser.as('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send({
      variantId: variant, adjustmentType: 'remove', quantity: 1, reason: 'damaged',
      note: 'Dropped during the valuation test', applyDirectly: true,
    }), 201);
    await assertReconciled('after damage');
    must(await adminUser.as('post', `/stock/quarantine/${variant}`).send({
      action: 'write_off', quantity: 1, reason: 'Beyond repair in the valuation test',
    }), 200, 201);
    await assertReconciled('after a quarantine write-off');
    const { rows: [po] } = await db.query(
      `SELECT purchase_order_id AS id FROM product_cost_history WHERE supplier_id = $1 LIMIT 1`, [s2]);
    must(await adminUser.as('post', '/supplier-returns').set('Idempotency-Key', randomUUID()).send({
      supplierId: s2, purchaseOrderId: po.id, reason: 'wrong_item',
      items: [{ productId: product, variantId: variant, quantity: 2, unitCost: 12 }],
    }), 201);
    await assertReconciled('after a supplier return');
  });

  it('puts a cancelled sale back at exactly its COGS', async () => {
    const before = await book();
    const s = await sale(3);
    must(await adminUser.as('post', `/invoices/${s.inv.id}/cancel`).send({ reason: 'Cancelled in the valuation test' }), 200);
    const after = await book();
    expect(after.value).toBe(before.value);
    expect(after.stock).toBe(before.stock);
    await assertReconciled('after a cancel');
  });

  it('revalues stock with a journal entry when the cost is corrected by hand', async () => {
    const res = await adminUser.as('put', `/products/${product}/variants/${variant}`).send({ costPrice: 11 });
    must(res, 200);
    const v = await book();
    expect(v.cost).toBe(11);
    expect(v.value).toBe(Math.round((v.stock + v.held) * 11 * 100) / 100);
    const { rows: [{ n }] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM journal_entries WHERE reference_type = 'variant_cost' AND reference_id = $1`, [variant]);
    expect(n).toBe(1);
    await assertReconciled('after a cost correction');
  });

  it('empties a variant with no value left over, and sells the legacy stock at its book value', async () => {
    await sale(4);
    const { rows: [legacy] } = await db.query(`SELECT inventory_value::float8 AS value, stock_qty::float8 AS stock FROM product_variants WHERE id = $1`, [legacyVariant]);
    expect(legacy).toEqual({ value: 100, stock: 4 }); // untouched by sales of another product
    const { rows: [before] } = await db.query(`SELECT stock_qty::float8 AS q FROM product_variants WHERE id = $1`, [variant]);
    await sale(before.q);
    expect(await book()).toMatchObject({ stock: 0, held: 0, value: 0 });
    await assertReconciled('after selling out');
  });

  it('lets only one of two simultaneous sales take the last units, with the books intact', async () => {
    await receive(s1, 3, 9);
    const draft = async () => must(await adminUser.as('post', '/invoices').send({ items: [{ variantId: variant, quantity: 3 }] }), 201);
    const a = await draft();
    const b = await draft();
    for (const inv of [a, b]) {
      must(await adminUser.as('post', `/invoices/${inv.id}/payments`).send({
        idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total), bankAccountId: bank,
      }), 201);
    }
    const results = await Promise.all([a, b].map((inv) => adminUser.as('post', `/invoices/${inv.id}/confirm`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await book()).toMatchObject({ stock: 0, value: 0 });
    await assertReconciled('after racing sales');
  });

  it('shows the reconciliation to finance users only', async () => {
    const rec = must(await adminUser.as('get', '/finance/inventory-reconciliation'), 200);
    expect(rec).toMatchObject({ policy: 'weighted_average', reconciled: true, difference: 0 });
    const cashier = await user('Cashier');
    expect((await cashier.as('get', '/finance/inventory-reconciliation')).status).toBe(403);
  });
});
