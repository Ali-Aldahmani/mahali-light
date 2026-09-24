/**
 * Report cost-visibility regression test.
 *
 * report.sales (Cashier default) and report.inventory (Warehouse default)
 * exposed product cost, gross profit and margin through sales_by_product,
 * custom_costing_sales, inventory_valuation, inventory_stock_levels,
 * dead_stock and custom_product_inventory — bypassing product.view_cost,
 * which every product/stock/invoice endpoint enforces. Cost fields are now
 * redacted from columns, rows, totals and exports for those viewers.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

const COST_KEY = /cost|profit|margin|cogs|balance/;

describe.skipIf(!enabled)('report cost visibility on real PostgreSQL', () => {
  let db, auth, app, request, admin, reportService;
  let adminToken, cashierToken, warehouseToken, variantId;
  const database = `report_cost_visibility_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const get = (path, token) => request(app).get(path).auth(token, { type: 'bearer' });
  const columnKeys = (body) => body.data.columns.map((c) => c.key);

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
    reportService = require('../../server/services/reportService');

    async function session(id) {
      const token = auth.signToken({ sub: id });
      await db.query(
        `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
        [id, auth.hashToken(token)],
      );
      return token;
    }
    async function makeUser(username, roleName) {
      const { rows: [role] } = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
      const { rows: [user] } = await db.query(
        `INSERT INTO users (username, password_hash, role_id, is_active) VALUES ($1,'unused',$2,true) RETURNING id`,
        [username, role.id],
      );
      return session(user.id);
    }

    const { rows: [seededAdmin] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminToken = await session(seededAdmin.id);
    cashierToken = await makeUser('cashier_costs', 'Cashier');
    warehouseToken = await makeUser('warehouse_costs', 'Warehouse');

    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Lamps') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('Desk Lamp', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    const { rows: [variant] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, 'SKU-COST-TEST', 'BC-COST-TEST', 100, 60, 50, true) RETURNING id`,
      [prod.id],
    );
    variantId = variant.id;

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/reports', require('../../server/routes/reports'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));

    // One confirmed sale so the sales reports have a row with a known cost.
    const created = await request(app).post('/invoices').auth(adminToken, { type: 'bearer' })
      .send({ items: [{ variantId, quantity: 2 }] });
    const invoiceId = created.body.data.id;
    await request(app).post(`/invoices/${invoiceId}/payments`).auth(adminToken, { type: 'bearer' })
      .send({ idempotencyKey: randomUUID(), method: 'cash', amount: created.body.data.total });
    const confirmed = await request(app).post(`/invoices/${invoiceId}/confirm`).auth(adminToken, { type: 'bearer' }).send({});
    expect(confirmed.status).toBe(200);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('shows cost, profit and margin to a viewer with product.view_cost', async () => {
    const res = await get('/reports/sales_by_product', adminToken);
    expect(res.status).toBe(200);
    expect(columnKeys(res.body)).toEqual(expect.arrayContaining(['cost', 'profit', 'margin']));
    expect(res.body.data.rows[0]).toMatchObject({ qty: 2, revenue: 200, cost: 120, profit: 80 });
    expect(res.body.data.meta.costRedacted).toBeUndefined();
  });

  it('redacts cost from sales_by_product for a cashier (columns, rows, totals)', async () => {
    const res = await get('/reports/sales_by_product?sort=profit', cashierToken);
    expect(res.status).toBe(200);
    expect(columnKeys(res.body).filter((k) => COST_KEY.test(k))).toEqual([]);
    expect(res.body.data.rows[0]).toMatchObject({ qty: 2, revenue: 200 });
    for (const row of res.body.data.rows) {
      expect(Object.keys(row).filter((k) => COST_KEY.test(k))).toEqual([]);
    }
    expect(Object.keys(res.body.data.totals || {}).filter((k) => COST_KEY.test(k))).toEqual([]);
    expect(res.body.data.meta.costRedacted).toBe(true);
  });

  it('redacts the costing report for a cashier', async () => {
    const res = await get('/reports/custom_costing_sales', cashierToken);
    expect(res.status).toBe(200);
    const keys = [...columnKeys(res.body), ...Object.keys(res.body.data.rows[0] || {})];
    expect(keys).not.toContain('cost_price');
    expect(keys).not.toContain('total_cost');
    expect(keys).not.toContain('profit_pct');
    expect(res.body.data.rows[0]).toMatchObject({ total_sale: 200 });
  });

  it.each(['inventory_valuation', 'inventory_stock_levels', 'dead_stock', 'custom_product_inventory'])(
    'redacts %s for warehouse staff',
    async (type) => {
      const res = await get(`/reports/${type}`, warehouseToken);
      expect(res.status).toBe(200);
      expect(columnKeys(res.body).filter((k) => COST_KEY.test(k))).toEqual([]);
      for (const row of res.body.data.rows) {
        expect(Object.keys(row).filter((k) => COST_KEY.test(k))).toEqual([]);
      }
    },
  );

  it('keeps cost out of exports too', async () => {
    const res = await get('/reports/sales_by_product/export?format=csv', cashierToken);
    expect(res.status).toBe(200);
    const header = res.text.split('\n').find((l) => l.includes('Revenue'));
    expect(header).toBeTruthy();
    expect(header).not.toMatch(/Cost|Profit|Margin/);
  });

  // Guard for future reports: any report reachable with a sales / inventory /
  // customer / warranty / returns / bills permission must declare its cost
  // columns in REGISTRY.costFields. Financial, supplier, attendance and
  // employee reports are money-by-design and gated by their own permissions.
  it('no non-financial report leaks cost-like columns to a viewer without product.view_cost', async () => {
    const exempt = new Set(['report.financial', 'report.suppliers', 'report.attendance', 'report.employees', 'errors.view_all']);
    const viewer = { permissions: ['report.sales', 'report.inventory'] };
    const leaks = [];
    for (const [type, def] of Object.entries(reportService.REGISTRY)) {
      if (exempt.has(def.permission)) continue;
      const data = await reportService.generateReport(type, {}, { viewer });
      const keys = (data.columns || []).map((c) => c.key).filter((k) => /cost|profit|margin|cogs/.test(k));
      if (keys.length) leaks.push(`${type}: ${keys.join(', ')}`);
    }
    expect(leaks).toEqual([]);
  });
});
