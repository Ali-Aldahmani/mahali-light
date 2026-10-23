/**
 * GET /analytics/kpi-series feeds the dashboard sparkline cards: per-day
 * revenue and net profit for the period (adding up like the KPI card), and
 * receivables / payables balances by day, anchored to today's live balance.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('dashboard KPI series on real PostgreSQL', () => {
  let db, admin, app, request, token, start, end, today;
  const database = `kpi_series_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  const iso = (d) => d.toISOString().slice(0, 10);

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
    const auth = require('../../server/middleware/auth');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    token = auth.signToken({ sub: u.id });
    await db.query(`INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`, [u.id, auth.hashToken(token)]);

    const { rows: [d] } = await db.query(`SELECT CURRENT_DATE::text AS today, (CURRENT_DATE - 5)::text AS start, (CURRENT_DATE + 10)::text AS "end"`);
    ({ today, start, end } = d);

    // Two sales three days apart (taxable 100 and 250, cost 40 and 100).
    for (const [n, daysAgo, taxable, cost] of [['INV-S-1', 3, 100, 40], ['INV-S-2', 0, 250, 100]]) {
      const { rows: [inv] } = await db.query(
        `INSERT INTO invoices (invoice_number, status, subtotal, discount_amount, taxable_amount, tax_amount, total, amount_paid, balance_due, payment_status, confirmed_at)
         VALUES ($1, 'confirmed', $2, 0, $2, 0, $2, $2, 0, 'paid', (CURRENT_DATE - $3::int) + time '12:00') RETURNING id`,
        [n, taxable, daysAgo],
      );
      await db.query(
        `INSERT INTO invoice_items (invoice_id, product_name, sku, unit_label, quantity, unit_price, cost_price_at_time, line_subtotal, line_total)
         VALUES ($1, 'Cable', 'C-1', 'pcs', 1, $2, $3, $2, $2)`,
        [inv.id, taxable, cost],
      );
    }
    // A cancelled sale never counts.
    await db.query(
      `INSERT INTO invoices (invoice_number, status, subtotal, discount_amount, taxable_amount, tax_amount, total, amount_paid, balance_due, payment_status, confirmed_at)
       VALUES ('INV-S-X', 'cancelled', 999, 0, 999, 0, 999, 0, 0, 'paid', CURRENT_DATE + time '12:00')`,
    );
    // An expense paid yesterday.
    const { rows: [cat] } = await db.query(`SELECT id FROM expense_categories LIMIT 1`);
    await db.query(
      `INSERT INTO one_time_expenses (category_id, description, amount, payment_method, expense_date, paid_by)
       VALUES ($1, 'Tea', 30, 'cash', CURRENT_DATE - 1, $2)`,
      [cat?.id || null, u.id],
    );

    // Receivables now: 500. The journal says 200 of it arrived today, so up to yesterday it was 300.
    await db.query(`INSERT INTO customers (name, credit_balance) VALUES ('Owes', 500)`);
    const { rows: [je] } = await db.query(
      `INSERT INTO journal_entries (entry_number, date, description) VALUES ('JE-T-1', CURRENT_DATE, 'Credit sale') RETURNING id`,
    );
    const { rows: [ar] } = await db.query(`SELECT id FROM chart_of_accounts WHERE code = '1003'`);
    await db.query(`INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 200, 0)`, [je.id, ar.id]);

    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/analytics', require('../../server/routes/analytics'));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ code: err.code, message: err.message }));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  const series = async () => (await request(app).get(`/analytics/kpi-series?start_date=${start}&end_date=${end}`).auth(token, { type: 'bearer' })).body.data;

  it('runs from the period start to today, not into the future', async () => {
    const s = await series();
    expect(s.days[0]).toBe(start);
    expect(s.days[s.days.length - 1]).toBe(today);
    expect(s.days).toHaveLength(6);
    for (const key of ['revenue', 'net_profit', 'receivables', 'payables']) expect(s[key]).toHaveLength(6);
  });

  it('revenue per day matches the confirmed sales and adds up to the KPI', async () => {
    const s = await series();
    expect(s.revenue[2]).toBe(100); // 3 days ago
    expect(s.revenue[5]).toBe(250); // today; the cancelled sale is ignored
    expect(s.revenue.reduce((a, b) => a + b, 0)).toBe(350);
    const kpi = (await request(app).get(`/analytics/kpis?start_date=${start}&end_date=${end}`).auth(token, { type: 'bearer' })).body.data;
    expect(kpi.revenue).toBe(350);
    expect(s.net_profit.reduce((a, b) => a + b, 0)).toBeCloseTo(kpi.net_profit, 2);
  });

  it('net profit subtracts cost of goods and the day’s expenses', async () => {
    const s = await series();
    expect(s.net_profit[2]).toBe(60); // 100 - 40
    expect(s.net_profit[4]).toBe(-30); // yesterday: only the expense
    expect(s.net_profit[5]).toBe(150); // 250 - 100
  });

  it('receivables end on today’s live balance and step back by the journal', async () => {
    const s = await series();
    expect(s.receivables[5]).toBe(500);
    expect(s.receivables[4]).toBe(300);
    expect(s.receivables[0]).toBe(300);
    expect(s.payables.every((v) => v === 0)).toBe(true);
  });
});
