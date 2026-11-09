/**
 * Per-product profit through HTTP on real PostgreSQL. Every figure is worked out
 * by hand from the sales below, and the totals must match the ledger P&L.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('product profit on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, bank, today;
  const database = `product_profit_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let rows;

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

  async function product(name, variants) {
    const { rows: [p] } = await db.query(
      `INSERT INTO products (name, has_variants) VALUES ($1, $2) RETURNING id`, [name, variants.length > 1]);
    const ids = [];
    for (const [sku, price, cost] of variants) {
      const { rows: [v] } = await db.query(
        `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
         VALUES ($1, $2, $3, $4, 1000) RETURNING id`, [p.id, sku, price, cost]);
      ids.push(v.id);
    }
    return { id: p.id, variants: ids };
  }

  async function sale(items, invoiceDiscount = 0) {
    const inv = must(await adminUser.as('post', '/invoices').send({ items, invoiceDiscount }), 201);
    must(await adminUser.as('post', `/invoices/${inv.id}/payments`).send({
      idempotencyKey: randomUUID(), method: 'card', amount: Number(inv.total), bankAccountId: bank,
    }), 201);
    must(await adminUser.as('post', `/invoices/${inv.id}/confirm`), 200);
    return inv;
  }

  async function returnOf(invoice, { quantity, refund = null, replacement = null }) {
    const { rows: [line] } = await db.query(
      `SELECT id, variant_id, product_id FROM invoice_items WHERE invoice_id = $1`, [invoice.id]);
    const req = must(await adminUser.as('post', '/return-requests').send({
      returnType: replacement ? 'customer_replace' : 'customer_refund',
      referenceType: 'invoice', referenceId: invoice.id, reason: 'customer_request',
      requestNote: 'Product profit test return',
      items: [{ invoiceItemId: line.id, variantId: line.variant_id, productId: line.product_id, quantity, condition: 'good' }],
      refundPlan: refund ? [{ method: 'bank', amount: refund, bankAccountId: bank }] : [],
      ...(replacement ? { replacementPlan: { items: replacement, differencePayment: { method: 'bank', bankAccountId: bank } } } : {}),
    }), 201);
    must(await adminUser.as('put', `/return-requests/${req.id}/approve`).send({}), 200);
  }

  const row = (name) => rows.find((r) => r.product_name === name);

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

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/analytics', require('../../server/routes/analytics'));
    app.use('/reports', require('../../server/routes/reports'));
    app.use(require('../../server/middleware/errors').errorHandler);
    adminUser = await user('Admin');

    const multi = await product('Multi Variant Switch', [['MV-1', 100, 40], ['MV-2', 100, 40]]);
    const lamp = await product('Single Lamp', [['SL-1', 100, 20]]);
    const cable = await product('Discounted Cable', [['DC-1', 100, 40]]);
    const fan = await product('Mostly Returned Fan', [['RF-1', 100, 10]]);
    const heater = await product('Exchanged Heater', [['EX-1', 100, 40]]);
    const source = await product('Swap Source', [['SW-1', 100, 40]]);
    const target = await product('Swap Target', [['SW-2', 120, 30]]);
    const zero = await product('Zero Cost Item', [['ZC-1', 100, 0]]);
    const loss = await product('Loss Maker', [['LM-1', 10, 50]]);

    await sale([{ variantId: multi.variants[0], quantity: 5 }]);
    await sale([{ variantId: multi.variants[1], quantity: 5 }]);
    await sale([{ variantId: lamp.variants[0], quantity: 5 }]);
    await sale([{ variantId: cable.variants[0], quantity: 10 }], 200);
    await returnOf(await sale([{ variantId: fan.variants[0], quantity: 10 }]), { quantity: 8, refund: 840 });
    await returnOf(await sale([{ variantId: heater.variants[0], quantity: 1 }]), {
      quantity: 1, replacement: [{ variantId: heater.variants[0], quantity: 1 }],
    });
    await returnOf(await sale([{ variantId: heater.variants[0], quantity: 1 }]), {
      quantity: 1, replacement: [{ variantId: heater.variants[0], quantity: 2 }],
    });
    await returnOf(await sale([{ variantId: source.variants[0], quantity: 1 }]), {
      quantity: 1, replacement: [{ variantId: target.variants[0], quantity: 1 }],
    });
    await sale([{ variantId: zero.variants[0], quantity: 1 }]);
    await sale([{ variantId: loss.variants[0], quantity: 2 }]);
    await sale([{
      isCustom: true, customDescription: 'Third party chandelier', thirdPartyName: 'Acme',
      quantity: 1, unitPrice: 200, customCostPrice: 120,
    }]);
    const cancelled = await sale([{ variantId: lamp.variants[0], quantity: 50 }]);
    must(await adminUser.as('post', `/invoices/${cancelled.id}/cancel`).send({ reason: 'Test cancel of a big sale' }), 200);

    rows = must(await adminUser.as('get',
      `/analytics/top-products?start_date=${today}&end_date=${today}&sort_by=profit&limit=50`), 200);
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('ranks the product that really earned the most first', () => {
    expect(rows[0].product_name).toBe('Multi Variant Switch');
    expect(rows.at(-1).product_name).toBe('Loss Maker');
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, i) => i + 1));
  });

  it('adds the variants of a product together, and can still show them apart', async () => {
    expect(row('Multi Variant Switch')).toMatchObject({
      units_sold: 10, revenue: 1000, cost_total: 400, gross_profit: 600, margin_pct: 60, variant_count: 2, sku: '',
    });
    const split = must(await adminUser.as('get',
      `/analytics/top-products?start_date=${today}&end_date=${today}&sort_by=profit&limit=50&group_by=variant`), 200);
    expect(split.filter((r) => r.product_name === 'Multi Variant Switch').map((r) => r.gross_profit)).toEqual([300, 300]);
  });

  it('takes returned goods off revenue, cost and profit, ex-VAT', () => {
    expect(row('Mostly Returned Fan')).toMatchObject({
      units_sold: 2, gross_units: 10, returned_qty: 8, revenue: 200, cost_total: 20, gross_profit: 180, return_rate_pct: 80,
    });
  });

  it('shares an invoice-level discount across its lines', () => {
    expect(row('Discounted Cable')).toMatchObject({ revenue: 800, cost_total: 400, gross_profit: 400, margin_pct: 50 });
  });

  it('counts an exchange once: like for like, and one for two', () => {
    expect(row('Exchanged Heater')).toMatchObject({ units_sold: 3, revenue: 300, cost_total: 120, gross_profit: 180 });
  });

  it('moves an exchange from the returned product to the replacement', () => {
    expect(row('Swap Source')).toMatchObject({ units_sold: 0, revenue: 0, cost_total: 0, gross_profit: 0 });
    expect(row('Swap Target')).toMatchObject({ units_sold: 1, revenue: 120, cost_total: 30, gross_profit: 90 });
  });

  it('keeps a below-cost sale negative, and leaves out a cancelled sale', () => {
    expect(row('Loss Maker')).toMatchObject({ gross_profit: -80, margin_pct: -400 });
    expect(row('Single Lamp')).toMatchObject({ units_sold: 5, gross_profit: 400 });
  });

  it('flags units sold with no cost on file, in analytics and the report', async () => {
    expect(row('Zero Cost Item')).toMatchObject({ missing_cost_qty: 1, gross_profit: 100 });
    expect(row('Single Lamp').missing_cost_qty).toBe(0);
    const report = must(await adminUser.as('get',
      `/reports/sales_by_product?start_date=${today}&end_date=${today}`), 200);
    expect(report.rows.find((r) => r.product_name === 'Zero Cost Item').cost_note).toBe('No cost on 1 sold');
    expect(report.rows.find((r) => r.product_name === 'Single Lamp').cost_note).toBe('');
  });

  it('hides cost, profit and margin from a role with analytics but not cost', async () => {
    const { rows: [role] } = await db.query(`INSERT INTO roles (name) VALUES ('Analyst') RETURNING id`);
    await db.query(
      `INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = 'analytics.view'`,
      [role.id]);
    const analyst = await user('Analyst');
    const q = `start_date=${today}&end_date=${today}&limit=50`;
    for (const path of ['top-products', 'worst-products']) {
      const byProfit = must(await analyst.as('get', `/analytics/${path}?${q}&sort_by=profit`), 200);
      const byRevenue = must(await analyst.as('get', `/analytics/${path}?${q}&sort_by=revenue`), 200);
      expect(byProfit.map((r) => r.product_name)).toEqual(byRevenue.map((r) => r.product_name));
      for (const r of byProfit) {
        expect(Object.keys(r).filter((k) => /cost|profit|margin/.test(k))).toEqual([]);
        expect(r.revenue).toEqual(expect.any(Number));
      }
    }
  });

  it('lists a custom line under its own name', () => {
    expect(row('Third party chandelier')).toMatchObject({ product_id: null, revenue: 200, cost_total: 120, gross_profit: 80 });
  });

  it('adds up to the ledger P&L, in the analytics figures and in the report', async () => {
    const { getProfitAndLoss } = require('../../server/services/financialReportService');
    const pl = await getProfitAndLoss({ startDate: today, endDate: today });
    const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
    expect(sum('revenue')).toBeCloseTo(pl.revenue.total, 2);
    expect(sum('cost_total')).toBeCloseTo(pl.cogs.total, 2);
    expect(sum('gross_profit')).toBeCloseTo(pl.grossProfit, 2);

    const report = must(await adminUser.as('get',
      `/reports/sales_by_product?start_date=${today}&end_date=${today}&sort=profit`), 200);
    expect(report.rows[0]).toMatchObject({ rank: 1, product_name: 'Multi Variant Switch', sku: '2 variants', qty: 10, profit: 600 });
    expect(report.totals.revenue).toBeCloseTo(pl.revenue.total, 2);
    expect(report.totals.cost).toBeCloseTo(pl.cogs.total, 2);
    expect(report.totals.profit).toBeCloseTo(pl.grossProfit, 2);
  });

  it('leaves a warranty replacement out, since its cost is warranty expense', async () => {
    const product2 = await product('Warranty Item', [['WI-1', 100, 40]]);
    await sale([{ variantId: product2.variants[0], quantity: 1 }]);
    const { rows: [free] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, confirmed_at) VALUES ($1, 'confirmed', NOW()) RETURNING id`, [randomUUID()]);
    await db.query(
      `INSERT INTO invoice_items (invoice_id, product_id, variant_id, product_name, sku, unit_label, quantity,
         unit_price, cost_price_at_time, discount_percent, discount_amount, line_subtotal, line_total, position)
       VALUES ($1, $2, $3, 'Warranty Item', 'WI-1', 'pcs', 1, 0, 40, 0, 0, 0, 0, 0)`,
      [free.id, product2.id, product2.variants[0]]);
    await db.query(
      `INSERT INTO warranty_claims (claim_number, issue_description, replacement_invoice_id) VALUES ($1, 'Broken', $2)`,
      [randomUUID(), free.id]);
    const after = must(await adminUser.as('get',
      `/analytics/top-products?start_date=${today}&end_date=${today}&sort_by=profit&limit=50`), 200);
    expect(after.find((r) => r.product_name === 'Warranty Item')).toMatchObject({ units_sold: 1, cost_total: 40, gross_profit: 60 });
  });

  it('counts a return in the period it happened, even if the sale was earlier', async () => {
    const earlier = await product('Earlier Sale', [['ES-1', 100, 40]]);
    const inv = await sale([{ variantId: earlier.variants[0], quantity: 2 }]);
    await db.query(`UPDATE invoices SET confirmed_at = NOW() - INTERVAL '40 days' WHERE id = $1`, [inv.id]);
    await returnOf(inv, { quantity: 1, refund: 105 });
    const now = must(await adminUser.as('get',
      `/analytics/top-products?start_date=${today}&end_date=${today}&sort_by=profit&limit=50`), 200);
    expect(now.find((r) => r.product_name === 'Earlier Sale')).toMatchObject({
      units_sold: -1, gross_units: 0, returned_qty: 1, revenue: -100, cost_total: -40, gross_profit: -60, margin_pct: 0,
    });
  });
});
