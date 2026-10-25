/**
 * Phase 4 of the audit fix plan: treasury and the ledger agree.
 *
 * Runs every treasury movement that has no business document behind it
 * (drawer open with a float change, manual cash in/out, a bank account's
 * opening balance, bank deposit/withdrawal, drawer↔bank transfers, a
 * shortage at drawer close) through the real routes, then checks that the
 * reconciliation report finds general-ledger cash and bank equal to the
 * drawer and the bank accounts.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('treasury and ledger on real PostgreSQL', () => {
  let db, admin, app, request, token, reconcile;
  const database = `treasury_ledger_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const post = (url, body) =>
    request(app).post(url).auth(token, { type: 'bearer' }).set('Idempotency-Key', randomUUID()).send(body);
  const balanceOf = async (code) => Number((await db.query(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS b
       FROM journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.code = $1`, [code])).rows[0].b);
  const drawerBalance = async () => Number((await db.query(`SELECT current_balance FROM cash_drawer`)).rows[0].current_balance);
  const differences = async (id) => {
    const r = (await reconcile(db.getPool())).find((x) => x.id === id);
    expect(r.error).toBeUndefined();
    return r.differences;
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
      require('../../server/utils/dates').todayStoreDate(),
    );
    ({ reconcile } = require('../../scripts/reconcile'));
    const auth = require('../../server/middleware/auth');
    const { rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    token = auth.signToken({ sub: userId });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [userId, auth.hashToken(token)]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/cash-drawer', require('../../server/routes/cashDrawer'));
    app.use('/bank-accounts', require('../../server/routes/bankAccounts'));
    app.use((err, _req, res, _next) =>
      res.status(err.status || (err.name === 'ZodError' ? 400 : 500)).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('every manual cash and bank movement keeps the ledger equal to the drawer and the banks', async () => {
    expect((await post('/cash-drawer/open', { openingBalance: 100 })).status).toBeLessThan(300);
    expect((await post('/cash-drawer/adjust', { amount: 50, direction: 'in', reason: 'Float top-up' })).status).toBeLessThan(300);
    expect((await post('/cash-drawer/adjust', { amount: 20, direction: 'out', reason: 'Owner took cash' })).status).toBeLessThan(300);

    const bankRes = await post('/bank-accounts', { bankName: 'Test Bank', accountName: 'Shop', openingBalance: 1000 });
    expect(bankRes.status).toBe(201);
    const bankId = bankRes.body.data.id;
    const bank2Res = await post('/bank-accounts', { bankName: 'Second Bank', accountName: 'Savings' });
    const bank2Id = bank2Res.body.data.id;

    expect((await post(`/bank-accounts/${bankId}/deposit`, { amount: 200 })).status).toBe(201);
    expect((await post(`/bank-accounts/${bankId}/withdrawal`, { amount: 50 })).status).toBe(201);
    expect((await post('/cash-drawer/transfer', { toType: 'bank_account', toId: bankId, amount: 30 })).status).toBeLessThan(300);
    expect((await post(`/bank-accounts/${bankId}/transfer`, { toType: 'cash_drawer', amount: 40 })).status).toBeLessThan(300);
    expect((await post(`/bank-accounts/${bankId}/transfer`, { toType: 'bank_account', toId: bank2Id, amount: 25 })).status).toBeLessThan(300);

    // Drawer: 100 + 50 − 20 − 30 + 40 = 140; counted 135 → 5 short.
    expect(await drawerBalance()).toBe(140);
    const close = await post('/cash-drawer/close', { closingBalance: 135, notes: 'Counted short', force: true });
    expect(close.status).toBeLessThan(300);
    expect(await balanceOf('5015')).toBe(5);

    // Reopened with a smaller float: 35 left the drawer between sessions.
    expect((await post('/cash-drawer/open', { openingBalance: 100 })).status).toBeLessThan(300);

    expect(await differences('gl_cash_vs_drawer')).toEqual([]);
    expect(await differences('gl_bank_vs_accounts')).toEqual([]);
    expect(await differences('journal_balanced')).toEqual([]);
    expect(await balanceOf('1001')).toBe(100);
    expect(await balanceOf('1002')).toBe(1000 + 200 - 50 + 30 - 40);
  });

  it('drawer close rebuilds expected cash from the session, not the stored balance', async () => {
    // Session open from the previous test with 100. Corrupt the stored
    // running balance; the session's own movements still say 100.
    await db.query(`UPDATE cash_drawer SET current_balance = current_balance + 7`);
    const res = await post('/cash-drawer/close', { closingBalance: 100 });
    expect(res.status).toBeLessThan(300);
    const { rows: [session] } = await db.query(
      `SELECT expected_balance, discrepancy FROM cash_drawer_sessions ORDER BY opened_at DESC LIMIT 1`);
    expect(Number(session.expected_balance)).toBe(100);
    expect(Number(session.discrepancy)).toBe(0);
    const { rows: flagged } = await db.query(
      `SELECT 1 FROM activity_log WHERE action = 'cash_drawer.running_balance_mismatch'`);
    expect(flagged).toHaveLength(1);
  });
  it('a warranty replacement moves the unit cost from inventory to warranty expense', async () => {
    const { rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Kettle') RETURNING id`);
    const { rows: [v] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, $2, 100, 40, 5) RETURNING id`, [p.id, randomUUID()]);
    const { rows: [w] } = await db.query(
      `INSERT INTO warranties (warranty_number, product_id, variant_id, start_date, end_date, duration_months)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + 365, 12) RETURNING id`, [`W-${randomUUID()}`, p.id, v.id]);
    const { rows: [c] } = await db.query(
      `INSERT INTO warranty_claims (claim_number, warranty_id, issue_description)
       VALUES ($1, $2, 'Stopped heating') RETURNING id`, [`C-${randomUUID()}`, w.id]);
    const inventoryBefore = await balanceOf('1004');

    await require('../../server/services/warrantyService').resolveWarrantyClaim({
      claimId: c.id, resolution: 'replaced', managerId: userId, pcIdentifier: 'TEST',
    });

    expect(await balanceOf('5016')).toBe(40);
    expect(await balanceOf('1004')).toBe(inventoryBefore - 40);
    expect(await differences('journal_balanced')).toEqual([]);
  });
});
