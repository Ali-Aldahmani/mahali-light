/**
 * Whole-repo review, finance batch, through HTTP on real PostgreSQL: period
 * reports use their period, closing a quarter or year locks it, Cashiers don't
 * get bank or profit figures, client dates are checked, and the drawer approver
 * check can't be used to guess passwords.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('finance review fixes on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, manager, cashier, accountId, variantId, productId, dates;
  const database = `review_fin_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  async function user(roleName) {
    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const username = `u_${randomUUID().slice(0, 8)}`;
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, 'x', $2) RETURNING id`,
      [username, role.id]);
    const token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1, $2, $3)`,
      [u.id, `pc-${randomUUID().slice(0, 6)}`, auth.hashToken(token)]);
    return { id: u.id, username, as: (method, url) => request(app)[method](url).auth(token, { type: 'bearer' }) };
  }

  const dayOffset = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    dates = require('../../server/utils/dates');
    await require('../../server/services/journalService').ensurePeriodsForDate(dates.todayStoreDate());

    ({ rows: [{ id: accountId }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, is_default)
       VALUES ('ENBD', 'Main', 100000, true) RETURNING id`));
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name) VALUES ('Review item') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 50, 20, 100) RETURNING id`, [productId, randomUUID()]));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/expenses', require('../../server/routes/expenses'));
    app.use('/bank-accounts', require('../../server/routes/bankAccounts'));
    app.use('/bills', require('../../server/routes/bills'));
    app.use('/treasury', require('../../server/routes/treasury'));
    app.use('/analytics', require('../../server/routes/analytics'));
    app.use('/cash-drawer', require('../../server/routes/cashDrawer'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use(require('../../server/middleware/errors').errorHandler);

    adminUser = await user('Admin');
    manager = await user('Manager');
    cashier = await user('Cashier');
  });

  afterAll(async () => {
    if (db) await db.getPool?.().end().catch(() => {});
    if (createdDatabase) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin?.end();
  });

  const expense = (body) => adminUser.as('post', '/expenses').set('Idempotency-Key', randomUUID()).send({
    description: 'Review expense', amount: 100, paymentMethod: 'bank', bankAccountId: accountId, ...body,
  });

  it('a P&L only counts revenue and expenses inside its dates', async () => {
    const old = dayOffset(-60);
    expect((await expense({ amount: 700, expenseDate: old })).status).toBe(201);
    const { getProfitAndLoss } = require('../../server/services/financialReportService');
    const window = await getProfitAndLoss({ startDate: dayOffset(-5), endDate: dayOffset(0) });
    expect(window.expenses.total).toBe(0);
    const full = await getProfitAndLoss({ startDate: old, endDate: old });
    expect(full.expenses.total).toBe(700);
  });

  it('closing a year stops postings to a date whose month is still open', async () => {
    const day = '2024-03-15';
    const { ensurePeriodsForDate } = require('../../server/services/journalService');
    await ensurePeriodsForDate(day);
    await db.query(`UPDATE financial_periods SET status = 'closed' WHERE name = 'FY 2024'`);
    const res = await expense({ expenseDate: day });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('FY 2024');
  });

  it('refuses a future date and a date that does not exist', async () => {
    expect((await expense({ expenseDate: dayOffset(2) })).status).toBe(400);
    expect((await expense({ expenseDate: '2026-02-31' })).status).toBe(400);
    expect((await expense({ expenseDate: 'soon' })).status).toBe(400);
  });

  it('an account holding money cannot be deactivated through an edit', async () => {
    const res = await adminUser.as('put', `/bank-accounts/${accountId}`).send({ isActive: false });
    expect(res.status).toBe(409);
    const { rows: [row] } = await db.query(`SELECT is_active FROM bank_accounts WHERE id = $1`, [accountId]);
    expect(row.is_active).toBe(true);
  });

  it('a cancelled bill cannot be resumed', async () => {
    const created = await adminUser.as('post', '/bills').send({
      name: 'Rent', amount: 300, frequency: 'monthly', startDate: dates.todayStoreDate(), paymentMethod: 'cash',
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect((await adminUser.as('delete', `/bills/${id}`)).status).toBe(200);
    expect((await adminUser.as('post', `/bills/${id}/resume`)).status).toBe(409);
  });

  it('a Cashier sees the drawer but not bank balances or the net position', async () => {
    const asCashier = await cashier.as('get', '/treasury/summary');
    expect(asCashier.status).toBe(200);
    expect(asCashier.body.data.banks.accounts).toEqual([]);
    expect(asCashier.body.data.banks.total).toBe(0);
    expect(asCashier.body.data.netPosition).toBe(0);
    expect(asCashier.body.data.recent.filter((r) => r.source === 'bank')).toEqual([]);
    const asManager = await manager.as('get', '/treasury/summary');
    expect(asManager.body.data.banks.accounts.length).toBeGreaterThan(0);
  });

  it('dashboard KPIs hide profit and stock value from a Cashier', async () => {
    const asCashier = await cashier.as('get', '/analytics/kpis');
    expect(asCashier.status).toBe(200);
    expect(asCashier.body.data.net_profit).toBeNull();
    expect(asCashier.body.data.inventory_value).toBeNull();
    expect(typeof asCashier.body.data.revenue).toBe('number');
    const asManager = await manager.as('get', '/analytics/kpis');
    expect(typeof asManager.body.data.net_profit).toBe('number');
    const series = await cashier.as('get', '/analytics/kpi-series');
    expect(series.body.data.net_profit).toEqual([]);
  });

  it('refuses a report range that would stall the database', async () => {
    const res = await cashier.as('get', '/analytics/sales-timeline?start_date=0001-01-01&end_date=9999-12-31');
    expect(res.status).toBe(400);
  });

  it('wrong approver passwords lock out, so the drawer close cannot guess them', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('correct horse battery', 4);
    await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, adminUser.id]);
    await manager.as('post', '/cash-drawer/open').send({ openingBalance: 0 });
    const attempt = (password) => manager.as('post', '/cash-drawer/close').send({
      closingBalance: 500, notes: 'Counted the drawer', approver: { username: adminUser.username, password },
    });
    for (let i = 0; i < 5; i += 1) {
      const res = await attempt(`wrong-${i}`);
      expect(res.status).toBe(409);
    }
    const res = await attempt('correct horse battery');
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('Too many wrong attempts');
  });

  it('a Manager can apply a direct stock adjustment, a Cashier still cannot', async () => {
    const body = {
      variantId, adjustmentType: 'add', quantity: 2, reason: 'found', note: 'Found behind the shelf', applyDirectly: true,
    };
    const asManager = await manager.as('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send(body);
    expect(asManager.status).toBe(201);
    const { rows: [v] } = await db.query(`SELECT stock_qty FROM product_variants WHERE id = $1`, [variantId]);
    expect(Number(v.stock_qty)).toBe(102);
    const asCashier = await cashier.as('post', '/stock/adjustments').set('Idempotency-Key', randomUUID()).send(body);
    expect(asCashier.status).toBe(403);
  });

  it('report CSV cells cannot run as spreadsheet formulas', () => {
    const { csvSafeCell } = require('../../server/services/reportExporter');
    expect(csvSafeCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(csvSafeCell('@cmd')).toBe(`'@cmd`);
    expect(csvSafeCell('-250.00')).toBe('-250.00');
    expect(csvSafeCell('Fan')).toBe('Fan');
  });
});
