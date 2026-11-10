/**
 * Product lifecycle through HTTP on real PostgreSQL: receipts, sales with
 * their receipt allocations, returns, exchanges, damage, aging by receipt,
 * the timeline, the lifecycle reports, and who may see which figures.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('product lifecycle on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, cashier, warehouse, bank, today;
  let s1, s2, product, variant, saleA, saleB, lifecycle;
  const pos = [];
  const database = `product_lifecycle_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const must = (res, ...status) => {
    expect(status, JSON.stringify(res.body)).toContain(res.status);
    return res.body.data;
  };
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

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
    pos.push(po);
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

  async function giveBack(s, quantity, replacement = null) {
    const r = must(await adminUser.as('post', '/return-requests').send({
      returnType: replacement ? 'customer_replace' : 'customer_refund',
      referenceType: 'invoice', referenceId: s.inv.id, reason: 'customer_request', requestNote: 'Lifecycle test return',
      items: [{ invoiceItemId: s.line.id, variantId: variant, productId: product, quantity, condition: 'good' }],
      refundPlan: replacement ? [] : [{ method: 'bank', amount: 105 * quantity, bankAccountId: bank }],
      ...(replacement ? { replacementPlan: { items: replacement } } : {}),
    }), 201);
    must(await adminUser.as('put', `/return-requests/${r.id}/approve`).send({}), 200);
  }

  const COST_KEY = /cost|cogs|profit|contribution|fees|value|turnover|margin/i;
  // Structural keys holding no cost figure themselves.
  const STRUCTURE = new Set(['costGroups', 'turnoverNote']);
  function keysDeep(v, out = new Set()) {
    if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
    return out;
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
    today = require('../../server/utils/dates').todayStoreDate();
    await require('../../server/services/journalService').ensurePeriodsForDate(today);
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
      generatePurchaseOrderPDFSafe: async () => null,
    } };
    ({ rows: [{ id: bank }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, is_default)
       VALUES ('B', 'A', 100000, true) RETURNING id`));
    await db.query(`INSERT INTO payment_providers (name, fee_method, fee_percent, is_default) VALUES ('Terminal', 'percent', 2, true)`);
    ({ rows: [{ id: s1 }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Alpha Trading') RETURNING id`));
    ({ rows: [{ id: s2 }] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Beta Imports') RETURNING id`));
    ({ rows: [{ id: product }] } = await db.query(`INSERT INTO products (name) VALUES ('Traced Heater') RETURNING id`));
    ({ rows: [{ id: variant }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, 'TH-1', 100, 0, 0) RETURNING id`, [product]));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/purchase-orders', require('../../server/routes/purchaseOrders'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use('/products', require('../../server/routes/products'));
    app.use('/reports', require('../../server/routes/reports'));
    app.use('/analytics', require('../../server/routes/analytics'));
    app.use(require('../../server/middleware/errors').errorHandler);
    adminUser = await user('Admin');
    cashier = await user('Cashier');
    warehouse = await user('Warehouse');

    // Three receipts: two at 10 (one group), one at 14. The first two are backdated for aging.
    await receive(s1, 10, 10);
    await receive(s1, 10, 10);
    await receive(s2, 5, 14);
    const { rows: rs } = await db.query(
      `SELECT r.id FROM inventory_batch_receipts r JOIN inventory_batches b ON b.id = r.batch_id
        WHERE b.variant_id = $1 ORDER BY r.received_at, r.id`, [variant]);
    await db.query(`UPDATE inventory_batch_receipts SET received_at = $2 WHERE id = $1`, [rs[0].id, daysAgo(100)]);
    await db.query(`UPDATE inventory_batch_receipts SET received_at = $2 WHERE id = $1`, [rs[1].id, daysAgo(45)]);
    await db.query(`UPDATE inventory_batches SET first_received_at = $2 WHERE variant_id = $1 AND unit_cost = 10`, [variant, daysAgo(100)]);

    const { rows: [ten] } = await db.query(`SELECT id FROM inventory_batches WHERE variant_id = $1 AND unit_cost = 10`, [variant]);
    saleA = await sale(12, [{ batchId: ten.id, quantity: 12 }]);
    saleB = await sale(3);
    await giveBack(saleA, 2);
    await giveBack(saleB, 1, [{ variantId: variant, quantity: 1 }]);
    must(await adminUser.as('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send({
      variantId: variant, adjustmentType: 'remove', quantity: 1, reason: 'damaged',
      note: 'Cracked casing in the lifecycle test', applyDirectly: true,
    }), 201);
    must(await adminUser.as('put', `/products/${product}/variants/${variant}`).send({ sellingPrice: 110 }), 200);
    lifecycle = must(await adminUser.as('get', `/products/${product}/lifecycle`), 200);
  }, 90000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('summarises the product from first receipt to what remains', () => {
    const o = lifecycle.overview;
    expect(o).toMatchObject({
      totalReceived: 25,
      soldUnits: 16, // 12 + 3 + the exchange replacement
      returnedUnits: 3,
      netSoldUnits: 13,
      available: 11, // 25 - 16 + 3 - 1 damaged
      reserved: null,
      writtenOff: 1,
    });
    expect(new Date(o.firstReceivedAt) < new Date(Date.now() - 99 * 86400000)).toBe(true);
    expect(o.grossProfit).toBeCloseTo(o.revenue - o.cogs, 2);
    expect(o.contribution).toBeCloseTo(o.grossProfit - o.paymentFees, 2);
    expect(o.paymentFees).toBeGreaterThan(0);
  });

  it('agrees with product profitability and the ledger', async () => {
    const top = must(await adminUser.as('get', `/analytics/top-products?start_date=2020-01-01&end_date=${today}&limit=50`), 200);
    const row = top.find((r) => r.product_id === product);
    expect(lifecycle.overview.revenue).toBeCloseTo(row.revenue, 2);
    expect(lifecycle.overview.cogs).toBeCloseTo(row.cost_total, 2);
    expect(lifecycle.overview.paymentFees).toBeCloseTo(row.payment_fees, 2);
    expect(lifecycle.overview.contribution).toBeCloseTo(row.contribution_profit, 2);
    const { rows: [{ value }] } = await db.query(`SELECT inventory_value::float8 AS value FROM product_variants WHERE id = $1`, [variant]);
    expect(lifecycle.overview.inventoryValue).toBe(value);
  });

  it('keeps every receipt apart, with supplier, PO and remaining units', async () => {
    const r = must(await adminUser.as('get', `/products/${product}/lifecycle/receipts`), 200);
    expect(r.total).toBe(3);
    const byCost = (c) => r.rows.filter((x) => x.unitCost === c);
    expect(byCost(10)).toHaveLength(2);
    expect(r.rows.every((x) => x.purchaseOrderId && x.poNumber)).toBe(true);
    expect(byCost(14)[0]).toMatchObject({ supplierName: 'Beta Imports', received: 5 });
    const oldest = r.rows.find((x) => x.daysInStock >= 99);
    expect(oldest).toMatchObject({ supplierName: 'Alpha Trading', received: 10, sold: 10 });
    expect(r.rows.reduce((s, x) => s + x.remaining, 0)).toBe(11);
  });

  it('lists each sale with the receipts it came from, its COGS and profit', async () => {
    const s = must(await adminUser.as('get', `/products/${product}/lifecycle/sales`), 200);
    const a = s.rows.find((x) => x.invoiceId === saleA.inv.id);
    expect(a).toMatchObject({ quantity: 12, returnedQuantity: 2, netQuantity: 10, invoiceNumber: saleA.inv.invoiceNumber });
    expect(a.allocations.map((x) => x.quantity)).toEqual([10, 2]);
    expect(new Set(a.allocations.map((x) => x.receiptId)).size).toBe(2);
    expect(a.allocations.every((x) => x.unitCost === 10 && x.batchNumber)).toBe(true);
    expect(a.grossProfit).toBeCloseTo(a.revenue - a.cogs, 2);
    const b = s.rows.find((x) => x.invoiceId === saleB.inv.id);
    expect(b.exchanged).toBe(true);
    expect(s.rows.some((x) => x.isReplacement)).toBe(true);
  });

  it('reports each cost group with its receipts, profit and time to sale', () => {
    const ten = lifecycle.costGroups.find((g) => g.unitCost === 10);
    // FIFO inside the group: receipt 1 sold out; receipt 2 took the rest of
    // sale A, sale B, the exchange replacement and the damaged unit.
    expect(ten).toMatchObject({ received: 20, sold: 16, returned: 3, outOther: 1, remaining: 6 });
    expect(ten.receipts).toHaveLength(2);
    expect(ten.averageDaysToSale).toBeGreaterThan(40);
    expect(ten.grossProfit).toBeCloseTo(ten.revenue - ten.bookCogs, 2);
    expect(ten.physicalGrossProfit).toBeCloseTo(ten.revenue - ten.physicalCost, 2);
  });

  it('ages stock by each receipt, not by the group\'s first date', () => {
    const b = Object.fromEntries(lifecycle.aging.buckets.map((x) => [x.key, x.quantity]));
    // Receipt 1 (100 days) is sold out; receipt 2 (45 days) holds 6; receipt 3 (today) holds 5.
    expect(b['91_180']).toBe(0);
    expect(b['31_60']).toBe(6);
    expect(b['0_30']).toBe(5);
    expect(lifecycle.aging.oldestRemaining.days).toBeGreaterThanOrEqual(44);
    expect(lifecycle.aging.averageDaysToSale).toBeGreaterThan(0);
  });

  it('measures sell-through, velocity and turnover on net COGS and average book value', async () => {
    const p = lifecycle.performance;
    expect(p.receivedUnits).toBe(25);
    expect(p.netSoldUnits).toBe(13);
    expect(p.sellThroughPct).toBe(52); // 13 / (0 + 25)
    expect(p.velocityPerDay).toBeGreaterThan(0);
    const { getProfitAndLoss } = require('../../server/services/financialReportService');
    const pl = await getProfitAndLoss({ startDate: p.period.startDate, endDate: today });
    expect(p.netCogs).toBeCloseTo(pl.cogs.total, 2);
    expect(p.averageValue).toBeCloseTo((p.openingValue + p.closingValue) / 2, 2);
    expect(p.turnover).toBeCloseTo(p.netCogs / p.averageValue, 1);
  });

  it('shows every event in order with who did it, its batches and a link', async () => {
    const t = must(await adminUser.as('get', `/products/${product}/lifecycle/timeline?limit=100`), 200);
    const types = t.rows.map((r) => r.type);
    for (const type of ['purchase', 'sale', 'return_in', 'exchange_return', 'adjustment', 'variant.updated']) {
      expect(types).toContain(type);
    }
    const times = t.rows.map((r) => new Date(r.at).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const sale = t.rows.find((r) => r.type === 'sale' && r.referenceId === saleA.inv.id);
    expect(sale).toMatchObject({ link: `/invoices/${saleA.inv.id}`, quantity: -12, valueChange: -Math.abs(sale.valueChange) });
    expect(sale.batches.length).toBe(2);
    expect(sale.employee).toBeTruthy();
    expect(t.rows.find((r) => r.type === 'adjustment').reason).toBe('damaged');
    expect(t.rows.find((r) => r.type === 'purchase').link).toMatch(/^\/purchase-orders\//);
    const onlySales = must(await adminUser.as('get', `/products/${product}/lifecycle/timeline?types=sale`), 200);
    expect(onlySales.rows.every((r) => r.type === 'sale')).toBe(true);
    const paged = must(await adminUser.as('get', `/products/${product}/lifecycle/timeline?limit=2&page=2`), 200);
    expect(paged.rows).toHaveLength(2);
    expect(paged.total).toBe(t.total);
  });

  it('includes the end date in the movement history', async () => {
    const res = must(await adminUser.as('get', `/stock/movements?variantId=${variant}&dateFrom=${today}&dateTo=${today}&limit=100`), 200);
    const all = must(await adminUser.as('get', `/stock/movements?variantId=${variant}&limit=100`), 200);
    expect((res.items || res).length).toBe((all.items || all).length);
    expect((res.items || res).length).toBeGreaterThan(0);
  });

  it('hides cost and profit from a cashier, and revenue and cost from the warehouse', async () => {
    const c = must(await cashier.as('get', `/products/${product}/lifecycle`), 200);
    expect([...keysDeep(c)].filter((k) => COST_KEY.test(k) && !STRUCTURE.has(k))).toEqual([]);
    expect([...keysDeep(c)]).not.toContain('supplierName');
    expect(c.overview.revenue).toEqual(expect.any(Number)); // cashiers hold report.sales
    const w = must(await warehouse.as('get', `/products/${product}/lifecycle/sales`), 200);
    expect([...keysDeep(w)].filter((k) => COST_KEY.test(k) && !STRUCTURE.has(k))).toEqual([]);
    expect([...keysDeep(w)]).not.toContain('revenue');
    const wr = must(await warehouse.as('get', `/products/${product}/lifecycle/receipts`), 200);
    expect(wr.rows[0].supplierName).toBeTruthy(); // warehouse may see suppliers
    expect(wr.rows[0]).not.toHaveProperty('unitCost');
  });

  it('runs every lifecycle report, and redacts cost for a cashier', async () => {
    const q = `start_date=2020-01-01&end_date=${today}`;
    for (const type of ['inventory_aging', 'slow_moving', 'inventory_turnover', 'cost_group_profitability',
      'receipt_profitability', 'supplier_profitability', 'inventory_reconciliation']) {
      const data = must(await adminUser.as('get', `/reports/${type}?${q}`), 200);
      expect(data.rows.length, type).toBeGreaterThan(0);
    }
    const aging = must(await adminUser.as('get', '/reports/inventory_aging'), 200);
    expect(aging.rows.find((r) => r.product_name === 'Traced Heater')).toMatchObject({ on_hand: 11, age_31_60: 6, age_0_30: 5 });
    const suppliers = must(await adminUser.as('get', `/reports/supplier_profitability?${q}`), 200);
    expect(suppliers.rows.map((r) => r.supplier)).toEqual(expect.arrayContaining(['Alpha Trading']));
    const rec = must(await adminUser.as('get', '/reports/inventory_reconciliation'), 200);
    expect(rec.summary).toMatchObject({ reconciled: true, difference: 0 });
    const groups = must(await cashier.as('get', `/reports/cost_group_profitability?${q}`), 200);
    expect(groups.columns.map((c) => c.key).filter((k) => /cost|cogs|profit|contribution|fees|margin/.test(k))).toEqual([]);
    const csv = await adminUser.as('get', `/reports/receipt_profitability/export?format=csv&${q}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Alpha Trading');
  });
});
