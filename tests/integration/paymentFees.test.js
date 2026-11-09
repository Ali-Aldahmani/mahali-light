/**
 * Card processing fees through HTTP on real PostgreSQL: provider settings and
 * who may change them, fees on the card part only, recorded once at the rates
 * of the day, full refunds to the customer, provider refund policies, and the
 * P&L's contribution profit.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('card processing fees on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, cashier, manager, bank, today, variantId;
  const database = `payment_fees_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

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

  async function provider(body) {
    return must(await adminUser.as('post', '/payment-providers').set('Idempotency-Key', randomUUID())
      .send({ name: `P ${randomUUID().slice(0, 6)}`, ...body }), 201);
  }

  // A 100 + 5% VAT sale (105), paid as listed: [{ method, amount, providerId? }].
  async function sale(payments, quantity = 1) {
    const inv = must(await adminUser.as('post', '/invoices').send({ items: [{ variantId, quantity }] }), 201);
    for (const p of payments) {
      must(await adminUser.as('post', `/invoices/${inv.id}/payments`).send({
        idempotencyKey: randomUUID(), bankAccountId: p.method === 'cash' ? undefined : bank, ...p,
      }), 201);
    }
    must(await adminUser.as('post', `/invoices/${inv.id}/confirm`), 200);
    return inv;
  }

  async function fees(invoiceId) {
    const { rows } = await db.query(
      `SELECT kind, source_type, base_amount::float8 AS base, fee_amount::float8 AS fee,
              fee_refunded::float8 AS fee_back, refund_charge::float8 AS charge, amount::float8 AS amount
         FROM payment_fees WHERE invoice_id = $1 ORDER BY created_at, id`, [invoiceId]);
    return rows;
  }

  async function feeLedger(invoiceId) {
    const { rows: [r] } = await db.query(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS net
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN chart_of_accounts a ON a.id = jl.account_id AND a.code = '5017'
        WHERE je.reference_type = 'payment_fee'
          AND je.reference_id IN (SELECT id FROM payment_fees WHERE invoice_id = $1)`, [invoiceId]);
    return r.net;
  }

  const bankBalance = async () => Number((await db.query(
    `SELECT current_balance FROM bank_accounts WHERE id = $1`, [bank])).rows[0].current_balance);

  async function refundReturn(inv, { quantity, amount }) {
    const { rows: [line] } = await db.query(`SELECT id, product_id FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    const r = must(await adminUser.as('post', '/return-requests').send({
      returnType: 'customer_refund', referenceType: 'invoice', referenceId: inv.id, reason: 'customer_request',
      requestNote: 'Card fee test return',
      items: [{ invoiceItemId: line.id, variantId, productId: line.product_id, quantity, condition: 'good' }],
      refundPlan: [{ method: 'bank', amount, bankAccountId: bank }],
    }), 201);
    must(await adminUser.as('put', `/return-requests/${r.id}/approve`).send({}), 200);
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
    await require('../../server/services/cashService').openDrawer({ openingBalance: 1000, employeeId: null });
    const pdfPath = require.resolve('../../server/services/pdfService');
    require.cache[pdfPath] = { id: pdfPath, filename: pdfPath, loaded: true, exports: {
      generateInvoicePDFSafe: async () => null, invalidateInvoicePDF: async () => {},
    } };
    ({ rows: [{ id: bank }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, is_default)
       VALUES ('B', 'A', 100000, true) RETURNING id`));
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Card Fee Item') RETURNING id`);
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty)
       VALUES ($1, 'CF-1', 100, 40, 0) RETURNING id`, [p.id]));
    await require('../../server/services/stockService').applyStockMovement({
      variantId, type: 'opening_stock', quantity: 500, unitCost: 40,
    });

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/invoices', require('../../server/routes/invoices'));
    app.use('/return-requests', require('../../server/routes/returnRequests'));
    app.use('/payment-providers', require('../../server/routes/paymentProviders'));
    app.use('/analytics', require('../../server/routes/analytics'));
    app.use(require('../../server/middleware/errors').errorHandler);
    adminUser = await user('Admin');
    cashier = await user('Cashier');
    manager = await user('Manager');
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('charges no fee while no provider is set up, as before', async () => {
    const inv = await sale([{ method: 'card', amount: 105 }]);
    expect(await fees(inv.id)).toEqual([]);
  });

  it('lets only fee managers change providers, logs each change, and hides rates from cashiers', async () => {
    const denied = await cashier.as('post', '/payment-providers').send({ name: 'Nope', feeMethod: 'percent', feePercent: 1 });
    expect(denied.status).toBe(403);
    const managerDenied = await manager.as('post', '/payment-providers').send({ name: 'Nope', feeMethod: 'percent', feePercent: 1 });
    expect(managerDenied.status).toBe(403);
    const p = await provider({ feeMethod: 'percent', feePercent: 2 });
    must(await adminUser.as('put', `/payment-providers/${p.id}`).send({ feePercent: 2.5 }), 200);
    const { rows: log } = await db.query(
      `SELECT action FROM activity_log WHERE entity_type = 'payment_provider' AND entity_id = $1 ORDER BY timestamp`, [p.id]);
    expect(log.map((r) => r.action)).toEqual(['payment_provider.created', 'payment_provider.updated']);
    const seen = must(await cashier.as('get', '/payment-providers'), 200);
    expect(seen.find((x) => x.id === p.id)).toEqual({ id: p.id, name: p.name, isDefault: false });
    const bad = await adminUser.as('post', '/payment-providers').send({ name: 'Bad', feeMethod: 'percent', feePercent: 150 });
    expect(bad.status).toBe(400);
  });

  it.each([
    ['percent', { feePercent: 2.5 }, 2.63],
    ['fixed', { feeFixed: 1.5 }, 1.5],
    ['percent_fixed', { feePercent: 2, feeFixed: 0.5 }, 2.6],
  ])('works out a %s fee on the card payment', async (feeMethod, rates, expected) => {
    const p = await provider({ feeMethod, ...rates });
    const inv = await sale([{ method: 'card', amount: 105, providerId: p.id }]);
    expect(await fees(inv.id)).toMatchObject([{ kind: 'charge', base: 105, fee: expected, amount: expected }]);
    expect(await feeLedger(inv.id)).toBe(expected);
  });

  it('charges only on the card part, never on cash or a transfer', async () => {
    const p = await provider({ feeMethod: 'percent', feePercent: 2 });
    const before = await bankBalance();
    const inv = await sale([
      { method: 'cash', amount: 30 },
      { method: 'transfer', amount: 25 },
      { method: 'card', amount: 50, providerId: p.id },
    ]);
    expect(await fees(inv.id)).toMatchObject([{ base: 50, fee: 1 }]);
    // The bank got the transfer and the card money less the provider's fee.
    expect(await bankBalance()).toBeCloseTo(before + 25 + 50 - 1, 2);
  });

  it('uses each provider\'s own rate, and the default provider when none is named', async () => {
    const cheap = await provider({ feeMethod: 'percent', feePercent: 1 });
    const dear = await provider({ feeMethod: 'percent', feePercent: 3, isDefault: true });
    const inv = await sale([
      { method: 'card', amount: 60, providerId: cheap.id },
      { method: 'card', amount: 45 },
    ]);
    expect((await fees(inv.id)).map((f) => f.fee).sort()).toEqual([0.6, 1.35]);
    const { rows } = await db.query(`SELECT provider_id FROM invoice_payments WHERE invoice_id = $1 AND tender = 'card'`, [inv.id]);
    expect(rows.map((r) => r.provider_id).sort()).toEqual([cheap.id, dear.id].sort());
  });

  it('keeps the fee a sale was charged when the provider\'s rate changes later', async () => {
    const p = await provider({ feeMethod: 'percent', feePercent: 2 });
    const inv = await sale([{ method: 'card', amount: 105, providerId: p.id }]);
    must(await adminUser.as('put', `/payment-providers/${p.id}`).send({ feePercent: 9 }), 200);
    expect(await fees(inv.id)).toMatchObject([{ fee: 2.1 }]);
    const { rows: [row] } = await db.query(`SELECT fee_percent::float8 AS pct FROM payment_fees WHERE invoice_id = $1`, [inv.id]);
    expect(row.pct).toBe(2);
  });

  it('refunds the customer in full on a cancel and keeps the fee as an expense by default', async () => {
    const p = await provider({ feeMethod: 'percent', feePercent: 2 });
    const inv = await sale([{ method: 'card', amount: 105, providerId: p.id }]);
    const before = await bankBalance();
    must(await adminUser.as('post', `/invoices/${inv.id}/cancel`).send({ reason: 'Card fee cancel test' }), 200);
    // 105 went back to the customer; the 2.10 fee is not given back.
    expect(await bankBalance()).toBeCloseTo(before - 105, 2);
    expect(await fees(inv.id)).toMatchObject([
      { kind: 'charge', fee: 2.1 },
      { kind: 'refund', source_type: 'invoice_cancel', base: 105, fee_back: 0, charge: 0, amount: 0 },
    ]);
    expect(await feeLedger(inv.id)).toBe(2.1);
  });

  it('gives back the fee in proportion on a partial refund when the provider does', async () => {
    const p = await provider({ feeMethod: 'percent', feePercent: 2, refundFeePolicy: 'proportional' });
    const inv = await sale([{ method: 'card', amount: 210, providerId: p.id }], 2);
    const before = await bankBalance();
    await refundReturn(inv, { quantity: 1, amount: 105 });
    // The customer gets all 105; the provider returns half of the 4.20 fee.
    expect(await bankBalance()).toBeCloseTo(before - 105 + 2.1, 2);
    expect(await fees(inv.id)).toMatchObject([
      { kind: 'charge', fee: 4.2 },
      { kind: 'refund', source_type: 'return_order', base: 105, fee_back: 2.1, amount: -2.1 },
    ]);
    expect(await feeLedger(inv.id)).toBe(2.1);
  });

  it('adds the provider\'s refund charge on top of the kept fee', async () => {
    const p = await provider({ feeMethod: 'percent', feePercent: 2, refundChargeMethod: 'fixed', refundChargeFixed: 1 });
    const inv = await sale([{ method: 'card', amount: 105, providerId: p.id }]);
    await refundReturn(inv, { quantity: 1, amount: 105 });
    expect(await fees(inv.id)).toMatchObject([{ kind: 'charge', fee: 2.1 }, { kind: 'refund', fee_back: 0, charge: 1, amount: 1 }]);
    expect(await feeLedger(inv.id)).toBe(3.1);
  });

  it('never refunds more card money than was taken, across a return and a later cancel', async () => {
    const p = await provider({ feeMethod: 'percent', feePercent: 2, refundFeePolicy: 'proportional' });
    const inv = await sale([{ method: 'card', amount: 210, providerId: p.id }], 2);
    await refundReturn(inv, { quantity: 1, amount: 105 });
    const res = await adminUser.as('post', `/invoices/${inv.id}/cancel`).send({ reason: 'Cancel after a return' });
    if (res.status === 200) {
      const rows = await fees(inv.id);
      const refunded = rows.filter((r) => r.kind === 'refund').reduce((s, r) => s + r.base, 0);
      expect(refunded).toBeLessThanOrEqual(210);
      expect(rows.filter((r) => r.kind === 'refund').reduce((s, r) => s + r.fee_back, 0)).toBeLessThanOrEqual(4.2);
    } else {
      // An invoice with a return may not be cancellable; the fee stays as it was.
      expect(await feeLedger(inv.id)).toBe(2.1);
    }
  });

  it('takes fees off contribution profit, not gross profit, and the product figures agree', async () => {
    const { getProfitAndLoss } = require('../../server/services/financialReportService');
    const pl = await getProfitAndLoss({ startDate: today, endDate: today });
    const { rows: [{ total }] } = await db.query(`SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM payment_fees`);
    expect(pl.paymentFees.total).toBeCloseTo(total, 2);
    expect(pl.contributionProfit).toBeCloseTo(pl.grossProfit - pl.paymentFees.total, 2);
    expect(pl.netProfit).toBeCloseTo(pl.contributionProfit - pl.expenses.total, 2);
    expect(pl.expenses.lines.map((l) => l.code)).not.toContain('5017');
    expect(pl.grossProfit).toBeCloseTo(pl.revenue.total - pl.cogs.total, 2);

    const rows = must(await adminUser.as('get',
      `/analytics/top-products?start_date=${today}&end_date=${today}&sort_by=contribution&limit=50`), 200);
    const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
    expect(sum('payment_fees')).toBeCloseTo(pl.paymentFees.total, 1);
    expect(sum('contribution_profit')).toBeCloseTo(pl.contributionProfit, 1);
  });
});
