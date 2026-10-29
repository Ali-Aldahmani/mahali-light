/**
 * Round 2, Phase 5 parts 2–3, on real PostgreSQL:
 * - SI-03: card and bank transfer are separate tenders that must name an
 *   active bank account; the sale posts to that account
 * - SI-06: a cash sale needs an open drawer; a manager can override with a
 *   reason, which is logged
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('phase 5 payments on real PostgreSQL', () => {
  let db, admin, app, request, variantId, cashier, manager, accountId, closedAccountId;
  const database = `phase5_pay_${randomUUID().replaceAll('-', '')}`;
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
    } };
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Pay item') RETURNING id`);
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 50, 20, 100) RETURNING id`, [p.id, randomUUID()]));
    ({ rows: [{ id: accountId }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance) VALUES ('ENBD', 'Shop main', 0) RETURNING id`));
    ({ rows: [{ id: closedAccountId }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, is_active) VALUES ('ADCB', 'Old', false) RETURNING id`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/bank-accounts', require('../../server/routes/bankAccounts'));
    app.use(require('../../server/middleware/errors').errorHandler);
    cashier = await user('Cashier');
    manager = await user('Manager');
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function draft(by) {
    const res = await by.as('post', '/invoices').send({ items: [{ variantId, quantity: 1 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
  }
  const pay = (by, id, body) => by.as('post', `/invoices/${id}/payments`).send({ idempotencyKey: randomUUID(), ...body });
  const drawerSessions = async () => Number((await db.query(`SELECT COUNT(*) AS n FROM cash_drawer_sessions`)).rows[0].n);

  // --- SI-03 -------------------------------------------------------------

  it('SI-03: card and transfer must name an active bank account', async () => {
    const inv = await draft(cashier);
    const total = Number(inv.total);
    expect((await pay(cashier, inv.id, { method: 'card', amount: total })).status).toBe(400);
    expect((await pay(cashier, inv.id, { method: 'transfer', amount: total, bankAccountId: closedAccountId })).status).toBe(400);
    expect((await pay(cashier, inv.id, { method: 'bank', amount: total })).status).toBe(400);
  });

  it('SI-03: a card payment records its tender and reference and posts to the chosen account', async () => {
    const inv = await draft(cashier);
    const total = Number(inv.total);
    const res = await pay(cashier, inv.id, { method: 'card', amount: total, bankAccountId: accountId, reference: 'SLIP-4471' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ method: 'bank', tender: 'card', reference: 'SLIP-4471', bankAccountId: accountId });

    expect((await cashier.as('post', `/invoices/${inv.id}/confirm`)).status).toBe(200);
    const { rows: [tx] } = await db.query(
      `SELECT bank_account_id, amount FROM bank_transactions WHERE reference_id = $1`, [inv.id]);
    expect(tx).toMatchObject({ bank_account_id: accountId });
    expect(Number(tx.amount)).toBe(total);
  });

  it('SI-03: replaying a payment key with a different tender is refused', async () => {
    const inv = await draft(cashier);
    const key = randomUUID();
    const body = { idempotencyKey: key, method: 'card', amount: 10, bankAccountId: accountId };
    expect((await cashier.as('post', `/invoices/${inv.id}/payments`).send(body)).status).toBe(201);
    expect((await cashier.as('post', `/invoices/${inv.id}/payments`).send(body)).status).toBe(200);
    expect((await cashier.as('post', `/invoices/${inv.id}/payments`).send({ ...body, method: 'transfer' })).status).toBe(409);
  });

  it('SI-03: a bank payment saved before the upgrade, with no account, still confirms', async () => {
    const inv = await draft(cashier);
    await db.query(
      `INSERT INTO invoice_payments (invoice_id, method, amount, employee_id, idempotency_key)
       VALUES ($1, 'bank', $2, $3, $4)`, [inv.id, inv.total, cashier.id, randomUUID()]);
    await db.query(`UPDATE bank_accounts SET is_default = true WHERE id = $1`, [accountId]);
    expect((await cashier.as('post', `/invoices/${inv.id}/confirm`)).status).toBe(200);
  });

  it('SI-03: a cashier can list payment accounts, without balances', async () => {
    const res = await cashier.as('get', '/bank-accounts/for-payments');
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.id)).toEqual([accountId]);
    expect(res.body.data[0]).not.toHaveProperty('currentBalance');
    expect(res.body.data[0]).not.toHaveProperty('current_balance');
  });

  // --- SI-06 -------------------------------------------------------------

  it('SI-06: a cash sale is refused while the drawer is closed, and no session is opened', async () => {
    const before = await drawerSessions();
    const inv = await draft(cashier);
    expect((await pay(cashier, inv.id, { method: 'cash', amount: Number(inv.total) })).status).toBe(201);
    const res = await cashier.as('post', `/invoices/${inv.id}/confirm`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BIZ_DRAWER_CLOSED');
    expect(await drawerSessions()).toBe(before);
    const { rows: [after] } = await db.query(`SELECT status FROM invoices WHERE id = $1`, [inv.id]);
    expect(after.status).toBe('draft');
  });

  it('SI-06: a card sale goes through with the drawer closed', async () => {
    const inv = await draft(cashier);
    await pay(cashier, inv.id, { method: 'card', amount: Number(inv.total), bankAccountId: accountId });
    expect((await cashier.as('post', `/invoices/${inv.id}/confirm`)).status).toBe(200);
  });

  it('SI-06: only a manager can override, and only with a reason', async () => {
    const mine = await draft(cashier);
    await pay(cashier, mine.id, { method: 'cash', amount: Number(mine.total) });
    expect((await cashier.as('post', `/invoices/${mine.id}/confirm`)
      .send({ closedDrawerOverride: { reason: 'Customer is waiting' } })).status).toBe(403);

    const inv = await draft(manager);
    await pay(manager, inv.id, { method: 'cash', amount: Number(inv.total) });
    expect((await manager.as('post', `/invoices/${inv.id}/confirm`)
      .send({ closedDrawerOverride: { reason: 'no' } })).status).toBe(400);

    const ok = await manager.as('post', `/invoices/${inv.id}/confirm`)
      .send({ closedDrawerOverride: { reason: 'Opening float not counted yet' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const { rows: [session] } = await db.query(
      `SELECT notes FROM cash_drawer_sessions ORDER BY opened_at DESC LIMIT 1`);
    expect(session.notes).toMatch(/Opening float not counted yet/);
    const { rows: log } = await db.query(
      `SELECT notes FROM activity_log WHERE action = 'cash.closed_drawer_override'`);
    expect(log.some((l) => /Opening float not counted yet/.test(l.notes))).toBe(true);
  });
});
