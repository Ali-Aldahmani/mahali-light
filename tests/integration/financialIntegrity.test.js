/**
 * Financial integrity through HTTP on real PostgreSQL: input VAT on expenses
 * and bills, payroll accrual, payment and advances, permissions, one ledger
 * source for every profit figure, and a trial balance and balance sheet that
 * balance with no plug. Expected entries are worked out by hand here.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('financial integrity on real PostgreSQL', () => {
  let db, admin, app, request, adminUser, manager, bank, today, fr, journal;
  let ym, ymPrev2, monthDays, empA, empB, empC;
  const database = `financial_integrity_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const must = (res, ...status) => {
    expect(status, JSON.stringify(res.body)).toContain(res.status);
    return res.body.data;
  };
  const r2 = (n) => Math.round(n * 100) / 100;

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

  const balance = async (code) => {
    const { rows: [r] } = await db.query(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS b FROM journal_lines jl
         JOIN chart_of_accounts a ON a.id = jl.account_id WHERE a.code = $1`, [code]);
    return r2(r.b);
  };
  const entryLines = async (referenceType, referenceId) => {
    const { rows } = await db.query(
      `SELECT a.code, jl.debit::float8 AS debit, jl.credit::float8 AS credit, je.date::text AS date
         FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id
         JOIN chart_of_accounts a ON a.id = jl.account_id
        WHERE je.reference_type = $1 AND je.reference_id = $2 ORDER BY a.code`, [referenceType, referenceId]);
    return rows;
  };
  const cat = async (name) => (await db.query(`SELECT id FROM expense_categories WHERE name = $1`, [name])).rows[0].id;
  const expense = (body, key = randomUUID()) => adminUser.as('post', '/expenses').set('Idempotency-Key', key).send({
    paymentMethod: 'bank', bankAccountId: bank, ...body,
  });

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
    journal = require('../../server/services/journalService');
    fr = require('../../server/services/financialReportService');
    // Payroll for last month, a void test two months ago.
    const d = new Date(`${today}T00:00:00Z`);
    const lastEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    ym = { year: lastEnd.getUTCFullYear(), month: lastEnd.getUTCMonth() + 1 };
    monthDays = lastEnd.getUTCDate();
    const prev2End = new Date(Date.UTC(ym.year, ym.month - 1, 0));
    ymPrev2 = { year: prev2End.getUTCFullYear(), month: prev2End.getUTCMonth() + 1 };
    for (const day of [today, lastEnd.toISOString().slice(0, 10), prev2End.toISOString().slice(0, 10)]) {
      await journal.ensurePeriodsForDate(day);
    }
    ({ rows: [{ id: bank }] } = await db.query(
      `INSERT INTO bank_accounts (bank_name, account_name, current_balance, is_default) VALUES ('B', 'Main', 50000, true) RETURNING id`));

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    for (const [p, r] of [['/expenses', 'expenses'], ['/bills', 'bills'], ['/bill-payments', 'billPayments'],
      ['/payroll', 'payroll'], ['/reports', 'reports'], ['/finance', 'finance'], ['/analytics', 'analytics'],
      ['/invoices', 'invoices'], ['/cash-drawer', 'cashDrawer']]) {
      app.use(p, require(`../../server/routes/${r}`));
    }
    app.use(require('../../server/middleware/errors').errorHandler);
    adminUser = await user('Admin');
    manager = await user('Manager');

    const emp = async (name) => (await db.query(`INSERT INTO employees (name, standard_hours) VALUES ($1, 8) RETURNING id`, [name])).rows[0].id;
    empA = await emp('Aisha Monthly');
    empB = await emp('Bilal Daily');
    empC = await emp('Chen Advance');
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  // ----------------------------------------------------------------- VAT
  it('splits recoverable input VAT out of an expense', async () => {
    const e = must(await expense({ categoryId: await cat('Electricity'), description: 'DEWA', amount: 420, vatRate: 5 }), 201);
    expect(e.vatAmount).toBe(20);
    expect(await entryLines('expense', e.id)).toEqual([
      expect.objectContaining({ code: '1002', debit: 0, credit: 420 }),
      expect.objectContaining({ code: '2002', debit: 20, credit: 0 }),
      expect.objectContaining({ code: '5003', debit: 400, credit: 0 }),
    ]);
    const vat = await fr.getVATReport({ startDate: today, endDate: today });
    expect(vat.inputTaxExpenses).toBe(20);
    expect(vat.netExpensesWithVat).toBe(400);
  });

  it('works out a bill payment\'s VAT from the bill\'s rate, and refuses VAT beyond the amount', async () => {
    const bill = must(await adminUser.as('post', '/bills').send({
      name: 'Internet', categoryId: await cat('Internet'), amount: 315, vatRate: 5, frequency: 'monthly',
      startDate: today, paymentMethod: 'bank', bankAccountId: bank }), 201);
    expect(bill.vatRate).toBe(5);
    const { rows: [p] } = await db.query(`SELECT id FROM bill_payments WHERE bill_id = $1`, [bill.id]);
    must(await adminUser.as('post', `/bill-payments/${p.id}/pay`).send({ amountPaid: 315, paymentMethod: 'bank', bankAccountId: bank }), 200);
    expect(await entryLines('bill_payment', p.id)).toEqual([
      expect.objectContaining({ code: '1002', credit: 315 }),
      expect.objectContaining({ code: '2002', debit: 15 }),
      expect.objectContaining({ code: '5006', debit: 300 }),
    ]);
    const bad = await expense({ categoryId: await cat('Rent'), description: 'Rent', amount: 100, vatAmount: 150 });
    expect(bad.status).toBe(400);
  });

  it('claims no input VAT while VAT is switched off', async () => {
    await db.query(`UPDATE app_settings SET vat_enabled = false`);
    const res = await expense({ categoryId: await cat('Rent'), description: 'Rent', amount: 1050, vatRate: 5 });
    expect(res.status).toBe(400);
    const plain = must(await expense({ categoryId: await cat('Rent'), description: 'Rent', amount: 1050 }), 201);
    expect(plain.vatAmount).toBe(0);
    await db.query(`UPDATE app_settings SET vat_enabled = true`);
  });

  it('books a Salary expense to wages, not Miscellaneous', async () => {
    const e = must(await expense({ categoryId: await cat('Salary'), description: 'Casual helper', amount: 300 }), 201);
    expect((await entryLines('expense', e.id)).map((l) => l.code)).toEqual(['1002', '5002']);
  });

  // ------------------------------------------------------------- payroll
  it('keeps salaries away from everyone without payroll permission', async () => {
    expect((await manager.as('get', '/payroll/runs')).status).toBe(403);
    expect((await manager.as('put', `/payroll/employees/${empA}/pay`).send({ baseSalary: 1 })).status).toBe(403);
    expect((await manager.as('get', `/reports/payroll?year=${ym.year}&month=${ym.month}`)).status).toBe(403);
    const { rows: [role] } = await db.query(`INSERT INTO roles (name) VALUES ('Scheduler') RETURNING id`);
    await db.query(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE key = 'report.schedule'`, [role.id]);
    const scheduler = await user('Scheduler');
    const res = await scheduler.as('post', '/reports/scheduled').send({ report_type: 'payroll', frequency: 'monthly', day_of_month: 1, recipients: [{ name: 'Owner', email: 'owner@example.com' }] });
    expect(res.status).toBe(403);
  });

  it('sets pay with a logged change, and issues an advance as a receivable', async () => {
    must(await adminUser.as('put', `/payroll/employees/${empA}/pay`).send({
      salaryType: 'monthly', baseSalary: 3000, monthlyAllowance: 500, employerContributionRate: 5, overtimeMultiplier: 1.5 }), 200);
    must(await adminUser.as('put', `/payroll/employees/${empB}/pay`).send({ salaryType: 'daily', baseSalary: 200 }), 200);
    must(await adminUser.as('put', `/payroll/employees/${empC}/pay`).send({ salaryType: 'monthly', baseSalary: 2000 }), 200);
    const { rows: [log] } = await db.query(`SELECT old_value, new_value FROM activity_log WHERE action = 'employee.pay_changed' AND entity_id = $1`, [empA]);
    expect(Number(log.new_value.baseSalary)).toBe(3000);

    const before = await fr.getPLTotals({ startDate: today, endDate: today });
    const key = randomUUID();
    const issue = () => adminUser.as('post', '/payroll/advances').set('Idempotency-Key', key).send({
      employeeId: empA, amount: 400, method: 'bank', bankAccountId: bank, issuedDate: `${ym.year}-${String(ym.month).padStart(2, '0')}-05` });
    const a = must(await issue(), 201);
    must(await issue(), 200, 201); // replay, not a second advance
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM employee_advances WHERE employee_id = $1`, [empA]);
    expect(n).toBe(1);
    expect(await entryLines('employee_advance', a.id)).toEqual([
      expect.objectContaining({ code: '1002', credit: 400 }),
      expect.objectContaining({ code: '1006', debit: 400 }),
    ]);
    const after = await fr.getPLTotals({ startDate: today, endDate: today });
    expect(after.netProfit).toBe(before.netProfit); // an advance is not an expense
  });

  it('calculates a run from attendance, leave, overtime, allowances and advances', async () => {
    const mm = String(ym.month).padStart(2, '0');
    const day = (d) => `${ym.year}-${mm}-${String(d).padStart(2, '0')}`;
    // Aisha: 2 absent days, 3 overtime hours; unpaid leave of 5 days, 2 inside the month.
    await db.query(`INSERT INTO attendance (employee_id, date, status, working_hours, overtime_hours) VALUES
      ($1, $2, 'absent', 0, 0), ($1, $3, 'absent', 0, 0), ($1, $4, 'present', 11, 3)`, [empA, day(2), day(3), day(4)]);
    const nextMonthDay3 = new Date(Date.UTC(ym.year, ym.month, 3)).toISOString().slice(0, 10);
    await db.query(`INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
      VALUES ($1, 'unpaid', $2, $3, 5, 'Family', 'approved')`, [empA, day(monthDays - 1), nextMonthDay3]);
    // Bilal: 5 present days and a half day.
    for (let i = 1; i <= 5; i += 1) {
      await db.query(`INSERT INTO attendance (employee_id, date, status, working_hours) VALUES ($1, $2, 'present', 8)`, [empB, day(i + 9)]);
    }
    await db.query(`INSERT INTO attendance (employee_id, date, status, working_hours) VALUES ($1, $2, 'half_day', 4)`, [empB, day(20)]);

    const run = must(await adminUser.as('post', '/payroll/runs').set('Idempotency-Key', randomUUID()).send(ym), 201);
    const a = run.lines.find((l) => l.employeeId === empA);
    const dayRate = 3000 / monthDays;
    expect(a).toMatchObject({ basePay: 3000, allowances: 500, absentDays: 2, unpaidLeaveDays: 2, advanceRecovery: 400 });
    expect(a.absenceDeduction).toBe(r2(dayRate * 4));
    expect(a.overtimePay).toBe(r2(3 * (dayRate / 8) * 1.5));
    expect(a.grossPay).toBe(r2(3000 + 500 + a.overtimePay - a.absenceDeduction));
    expect(a.netPay).toBe(r2(a.grossPay - 400));
    expect(a.employerContribution).toBe(150);
    const b = run.lines.find((l) => l.employeeId === empB);
    expect(b).toMatchObject({ daysWorked: 5.5, basePay: 1100, grossPay: 1100 });
    const again = await adminUser.as('post', '/payroll/runs').set('Idempotency-Key', randomUUID()).send(ym);
    expect(again.status).toBe(409); // one live run per month
    // A manual deduction on Bilal.
    const adjusted = must(await adminUser.as('put', `/payroll/runs/${run.id}/lines/${b.id}`).send({ otherDeductions: 50 }), 200);
    expect(adjusted.lines.find((l) => l.employeeId === empB).netPay).toBe(1050);
    globalThis.__run = adjusted;
  });

  it('accrues the month\'s salaries as an expense and a liability on approval', async () => {
    const run = globalThis.__run;
    const approved = must(await adminUser.as('post', `/payroll/runs/${run.id}/approve`), 200);
    expect(approved.status).toBe('approved');
    const lines = await entryLines('payroll_run', run.id);
    const sumOf = (k) => r2(approved.lines.reduce((s, l) => s + l[k], 0));
    const by = Object.fromEntries(lines.map((l) => [l.code, l]));
    expect(by['5002'].debit).toBe(sumOf('grossPay'));
    expect(by['5018'].debit).toBe(150);
    expect(by['2004'].credit).toBe(sumOf('netPay'));
    expect(by['1006'].credit).toBe(400);
    expect(by['2005'].credit).toBe(r2(50 + 150));
    expect(lines[0].date).toBe(approved.periodEnd); // dated the last day of the month
    const { rows: [adv] } = await db.query(`SELECT recovered_amount::float8 AS r FROM employee_advances WHERE employee_id = $1`, [empA]);
    expect(adv.r).toBe(400);
    const pl = await fr.getPLTotals({ startDate: approved.periodStart, endDate: approved.periodEnd });
    expect(pl.expenses).toBeGreaterThanOrEqual(r2(sumOf('grossPay') + 150));
    expect(await balance('2004')).toBe(-sumOf('netPay')); // unpaid salaries are a liability
  });

  it('pays salaries against the liability, without touching profit again, exactly once', async () => {
    const run = globalThis.__run;
    const b = run.lines.find((l) => l.employeeId === empB);
    const plBefore = await fr.getPLTotals({ startDate: today, endDate: today });
    const monthBefore = await fr.getPLTotals({ startDate: run.periodStart, endDate: run.periodEnd });
    const bankBefore = await balance('1002');
    const key = randomUUID();
    const pay = () => adminUser.as('post', `/payroll/runs/${run.id}/pay`).set('Idempotency-Key', key)
      .send({ lineIds: [b.id], method: 'bank', bankAccountId: bank, paidDate: today });
    const [first, replay] = await Promise.all([pay(), pay()]);
    expect([first.status, replay.status]).toEqual([200, 200]);
    const { rows: [{ n }] } = await db.query(`SELECT COUNT(*)::int AS n FROM payroll_payments WHERE line_id = $1`, [b.id]);
    expect(n).toBe(1);
    const again = await adminUser.as('post', `/payroll/runs/${run.id}/pay`).set('Idempotency-Key', randomUUID())
      .send({ lineIds: [b.id], method: 'bank', bankAccountId: bank });
    expect(again.status).toBe(409);
    expect(await balance('1002')).toBe(r2(bankBefore - 1050));
    expect((await fr.getPLTotals({ startDate: today, endDate: today })).netProfit).toBe(plBefore.netProfit);
    expect((await fr.getPLTotals({ startDate: run.periodStart, endDate: run.periodEnd })).netProfit).toBe(monthBefore.netProfit);
    const now = must(await adminUser.as('get', `/payroll/runs/${run.id}`), 200);
    expect(now.status).toBe('partially_paid');
    // What is still owed: every line's unpaid net pay.
    expect(await balance('2004')).toBe(-r2(now.lines.reduce((s, l) => s + l.outstanding, 0)));
  });

  it('voids an unpaid run with a dated reversal and gives the advance back', async () => {
    must(await adminUser.as('post', '/payroll/advances').set('Idempotency-Key', randomUUID()).send({
      employeeId: empC, amount: 300, method: 'bank', bankAccountId: bank,
      issuedDate: `${ymPrev2.year}-${String(ymPrev2.month).padStart(2, '0')}-02` }), 201);
    const run = must(await adminUser.as('post', '/payroll/runs').set('Idempotency-Key', randomUUID()).send(ymPrev2), 201);
    must(await adminUser.as('post', `/payroll/runs/${run.id}/approve`), 200);
    const paid = globalThis.__run;
    const refused = await adminUser.as('post', `/payroll/runs/${paid.id}/void`).send({ reason: 'Wrong month entirely' });
    expect(refused.status).toBe(409); // salaries already paid on it
    const voided = must(await adminUser.as('post', `/payroll/runs/${run.id}/void`).send({ reason: 'Prepared by mistake' }), 200);
    expect(voided.status).toBe('voided');
    const { rows: [rev] } = await db.query(`SELECT date::text AS d FROM journal_entries WHERE id = $1`, [voided.reversalEntryId]);
    expect(rev.d).toBe(today);
    const { rows: [adv] } = await db.query(`SELECT recovered_amount::float8 AS r FROM employee_advances WHERE employee_id = $1`, [empC]);
    expect(adv.r).toBe(0);
    const { rows: [{ net }] } = await db.query(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0)::float8 AS net FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         JOIN chart_of_accounts a ON a.id = jl.account_id
        WHERE a.code = '5002' AND (je.reference_id = $1 OR je.id = $2)`, [run.id, voided.reversalEntryId]);
    expect(net).toBe(0);
  });

  // --------------------------------------------- one source for profit
  it('gives the same profit in the P&L, the KPIs and the trends', async () => {
    must(await adminUser.as('post', '/cash-drawer/open').send({ openingBalance: 200 }), 201);
    const { rows: [p] } = await db.query(`INSERT INTO products (name) VALUES ('Lamp') RETURNING id`);
    const { rows: [v] } = await db.query(`INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty) VALUES ($1, 'LP-1', 100, 0, 0) RETURNING id`, [p.id]);
    await require('../../server/services/stockService').applyStockMovement({ variantId: v.id, type: 'opening_stock', quantity: 5, unitCost: 40 });
    const inv = must(await adminUser.as('post', '/invoices').send({ items: [{ variantId: v.id, quantity: 2 }] }), 201);
    must(await adminUser.as('post', `/invoices/${inv.id}/payments`).send({ idempotencyKey: randomUUID(), method: 'cash', amount: Number(inv.total) }), 201);
    must(await adminUser.as('post', `/invoices/${inv.id}/confirm`), 200);
    const start = `${today.slice(0, 8)}01`;
    const pl = await fr.getProfitAndLoss({ startDate: start, endDate: today });
    const kpi = must(await adminUser.as('get', `/analytics/kpis?start_date=${start}&end_date=${today}`), 200);
    const trend = must(await adminUser.as('get', `/analytics/net-profit-trends?start_date=${start}&end_date=${today}&group_by=month`), 200);
    for (const [k, plValue] of [['revenue', pl.revenue.total], ['gross_profit', pl.grossProfit], ['net_profit', pl.netProfit]]) {
      expect(kpi[k], k).toBe(plValue);
      expect(trend.at(-1)[k], k).toBe(plValue);
    }
    expect(trend.at(-1).expenses).toBe(pl.expenses.total);
  });

  // --------------------------------------- trial balance and balance sheet
  it('balances the trial balance and the balance sheet with no plug', async () => {
    const { rows: [prepaid] } = await db.query(`SELECT id FROM chart_of_accounts WHERE code = '1005'`);
    const { rows: [bankAcc] } = await db.query(`SELECT id FROM chart_of_accounts WHERE code = '1002'`);
    must(await adminUser.as('post', '/finance/journal').send({
      date: today, description: 'Insurance paid a year ahead',
      lines: [{ accountId: prepaid.id, debit: 1200 }, { accountId: bankAcc.id, credit: 1200 }] }), 200, 201);
    const tb = must(await adminUser.as('get', `/finance/trial-balance?as_of_date=${today}`), 200);
    expect(tb.balanced).toBe(true);
    expect(tb.totals.balanceDebit).toBe(tb.totals.balanceCredit);
    const bs = must(await adminUser.as('get', `/finance/balance-sheet?as_of_date=${today}`), 200);
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe(0);
    expect(bs.assets.lines.find((l) => l.code === '1005').amount).toBe(1200);
    expect(bs.assets.lines.find((l) => l.code === '1006')).toBeTruthy(); // employee advances
    expect(bs.liabilities.lines.find((l) => l.code === '2004')).toBeTruthy(); // salaries payable
    expect(bs.equity.total).toBe(r2(bs.assets.total - bs.liabilities.total));
    expect(bs.equity.netEquity).toBe(bs.equity.total);
    const report = must(await adminUser.as('get', `/reports/trial_balance?as_of_date=${today}`), 200);
    expect(report.summary.balanced).toBe(true);
  });
});
