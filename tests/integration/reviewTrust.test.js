/**
 * Review, 8 Nov, through HTTP on real PostgreSQL: overdraft needs a permission,
 * owner-paid expenses touch no shop account, retries don't duplicate, a void
 * says why, bad ids are the caller's mistake, and muted means muted everywhere.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('trust and robustness fixes on real PostgreSQL', () => {
  let db, admin, app, request, manager, teller, accountId, variantId, productId;
  const database = `review_trust_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  async function user(roleName, grants = []) {
    const auth = require('../../server/middleware/auth');
    const { rows: [role] } = await db.query(`SELECT id FROM roles WHERE name = $1`, [roleName]);
    const { rows: [u] } = await db.query(
      `INSERT INTO users (username, password_hash, role_id) VALUES ($1, 'x', $2) RETURNING id`,
      [`u_${randomUUID().slice(0, 8)}`, role.id]);
    for (const key of grants) {
      await db.query(
        `INSERT INTO user_permissions (user_id, permission_id, granted)
         SELECT $1, id, true FROM permissions WHERE key = $2`, [u.id, key]);
    }
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
    ({ rows: [{ id: accountId }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance) VALUES ('ENBD', 'Main', 100) RETURNING id`));
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name) VALUES ('Trust item') RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 50, 20, 100) RETURNING id`, [productId, randomUUID()]));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/bank-accounts', require('../../server/routes/bankAccounts'));
    app.use('/expenses', require('../../server/routes/expenses'));
    app.use('/stock', require('../../server/routes/stock'));
    app.use('/customer-payments', require('../../server/routes/customerPayments'));
    app.use('/customers', require('../../server/routes/customers'));
    app.use('/reports', require('../../server/routes/reports'));
    app.use(require('../../server/middleware/errors').errorHandler);

    manager = await user('Manager');
    teller = await user('Cashier', ['bank.view', 'bank.transact']);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  const withdraw = (by, body) => by.as('post', `/bank-accounts/${accountId}/withdrawal`)
    .set('Idempotency-Key', randomUUID()).send({ amount: 500, ...body });

  it('the overdraft flag alone no longer overdraws; the permission does, and it is logged', async () => {
    expect((await withdraw(teller, { allowOverdraft: true })).status).toBe(403);
    expect((await withdraw(teller, {})).status).toBe(409);
    const ok = await withdraw(manager, { allowOverdraft: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const { rows } = await db.query(`SELECT 1 FROM activity_log WHERE action = 'bank_account.overdrawn'`);
    expect(rows.length).toBe(1);
  });

  it('an expense can\'t overdraw an account without the permission', async () => {
    const { rows: [{ id: small }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance) VALUES ('Small', 'S', 10) RETURNING id`);
    const service = require('../../server/services/expenseService');
    await expect(service.createExpense({
      description: 'Too much', amount: 50, paymentMethod: 'bank', bankAccountId: small, userId: manager.id, requestKey: randomUUID(),
    })).rejects.toMatchObject({ code: 'BIZ_INSUFFICIENT_BANK_BALANCE' });
  });

  it('an owner-paid expense moves no shop money and credits owner equity', async () => {
    const before = (await db.query(`SELECT current_balance FROM cash_drawer`)).rows[0]?.current_balance;
    const res = await manager.as('post', '/expenses').set('Idempotency-Key', randomUUID()).send({
      description: 'Owner paid this', amount: 75, paymentMethod: 'cash', fundingSource: 'owner',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await db.query(`SELECT current_balance FROM cash_drawer`)).rows[0]?.current_balance).toBe(before);
    const { rows: [line] } = await db.query(
      `SELECT jl.credit FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN chart_of_accounts ca ON ca.id = jl.account_id
        WHERE je.reference_type = 'expense' AND ca.code = '3001' AND jl.credit = 75`);
    expect(line).toBeTruthy();
  });

  it('a retried bank account create makes one account', async () => {
    const key = randomUUID();
    const send = () => manager.as('post', '/bank-accounts').set('Idempotency-Key', key)
      .send({ bankName: 'Retry Bank', accountName: 'Once', openingBalance: 500 });
    const first = await send();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await send();
    expect(second.body.data.id).toBe(first.body.data.id);
    const { rows } = await db.query(`SELECT 1 FROM bank_accounts WHERE bank_name = 'Retry Bank'`);
    expect(rows.length).toBe(1);
  });

  it('a double-submitted adjustment request files one request', async () => {
    const key = randomUUID();
    const send = () => manager.as('post', '/stock/adjustments').set('Idempotency-Key', key).send({
      variantId, adjustmentType: 'add', quantity: 1, reason: 'found', note: 'Found one behind the shelf',
    });
    const first = await send();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await send();
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('a void needs a reason, and keeps it', async () => {
    const { rows: [c] } = await db.query(`INSERT INTO customers (name, credit_balance) VALUES ('Payer', 100) RETURNING id`);
    const paid = await manager.as('post', `/customers/${c.id}/payments`).set('Idempotency-Key', randomUUID())
      .send({ amount: 50, paymentMethod: 'bank_transfer', bankAccountId: accountId });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    const id = paid.body.data.payment.id;
    expect((await manager.as('delete', `/customer-payments/${id}`)).status).toBe(400);
    const voided = await manager.as('delete', `/customer-payments/${id}`).send({ reason: 'Wrong customer' });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const { rows: [row] } = await db.query(`SELECT void_reason FROM customer_payment_voids WHERE id = $1`, [id]);
    expect(row.void_reason).toBe('Wrong customer');
  });

  it('a malformed id is a 400, and requests with no sign-in aren\'t logged', async () => {
    expect((await manager.as('get', '/customers/not-a-uuid')).status).toBe(400);
    const before = (await db.query(`SELECT COUNT(*)::int AS n FROM error_logs`)).rows[0].n;
    expect((await request(app).get('/customers')).status).toBe(401);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM error_logs`)).rows[0].n).toBe(before);
  });

  it('sorting sales by product on margin works', async () => {
    const res = await manager.as('get', '/reports/sales_by_product?sort=margin');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('muted notifications stay out of the list and the count', async () => {
    const service = require('../../server/services/notificationService');
    const { rows: [n] } = await db.query(
      `INSERT INTO notifications (type, category, severity, title, message, target_user_ids)
       VALUES ('t', 'finance', 'info', 'Muted one', 'm', $1::jsonb) RETURNING id`,
      [JSON.stringify([manager.id])]);
    expect(n.id).toBeTruthy();
    const count = await service.getUnreadCount(manager.id, 'Manager');
    await db.query(`UPDATE notification_preferences SET finance_alerts = false WHERE user_id = $1`, [manager.id]);
    expect(await service.getUnreadCount(manager.id, 'Manager')).toBe(count - 1);
    const list = await service.listForUser({ userId: manager.id, role: 'Manager' });
    expect(list.map((row) => row.title)).not.toContain('Muted one');
  });
});
