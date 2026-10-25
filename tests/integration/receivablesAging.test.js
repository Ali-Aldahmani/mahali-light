/**
 * Phase 4 of the audit fix plan: credit sales are not collected money, and
 * receivables are aged from the credit sales that are still open (F04/F20).
 *
 * One customer: an old credit sale of 100 (90 days ago), a recent sale of
 * 100 paid 80 on credit + 20 cash (10 days ago), then a collection of 30.
 * Open balance 150 = the recent 80 (1–30 days) + 70 of the old sale (60+).
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('collections and receivables aging on real PostgreSQL', () => {
  let db, admin, reports, analytics;
  const database = `receivables_aging_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let range;

  async function creditSale(number, userId, customerId, daysAgo, payments) {
    const total = payments.reduce((s, p) => s + p.amount, 0);
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, customer_id, subtotal, discount_amount, invoice_discount,
                             taxable_amount, tax_rate, tax_amount, total, amount_paid, balance_due,
                             payment_status, created_by, confirmed_by, confirmed_at)
       VALUES ($1, 'confirmed', $2, $3, 0, 0, $3, 0, 0, $3, $3, 0, 'paid', $4, $4, NOW() - make_interval(days => $5))
       RETURNING id`,
      [number, customerId, total, userId, daysAgo],
    );
    for (const p of payments) {
      await db.query(`INSERT INTO invoice_payments (invoice_id, method, amount) VALUES ($1, $2, $3)`,
        [inv.id, p.method, p.amount]);
    }
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
    reports = require('../../server/services/reportService');
    analytics = require('../../server/services/analyticsService');
    const { todayStoreDate } = require('../../server/utils/dates');

    const { rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    const { rows: [c] } = await db.query(
      `INSERT INTO customers (name, credit_balance) VALUES ('Aging Co', 150) RETURNING id`);
    await creditSale('INV-AGE-OLD', userId, c.id, 90, [{ method: 'credit', amount: 100 }]);
    await creditSale('INV-AGE-NEW', userId, c.id, 10, [{ method: 'credit', amount: 80 }, { method: 'cash', amount: 20 }]);

    const today = todayStoreDate();
    const start = new Date(Date.parse(`${today}T00:00:00Z`) - 120 * 86400000).toISOString().slice(0, 10);
    range = { start_date: start, end_date: today, startDate: start, endDate: today };
  }, 30000);

  afterAll(async () => {
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('sales summary counts only money received as collected; credit is on account', async () => {
    const report = await reports.REGISTRY.sales_summary.fn(range);
    expect(report.summary.totalCollected).toBe(20);
    expect(report.summary.onAccount).toBe(180);
    expect(report.rows.map((r) => r.method)).toEqual(['cash']);
  });

  it('analytics collection rate leaves out what was put on account', async () => {
    const kpis = await analytics.getKPIs(range);
    // 200 invoiced, 20 actually collected.
    expect(kpis.collection_rate_pct).toBe(10);
  });

  it('receivables are aged from the credit sales still open', async () => {
    const report = await reports.REGISTRY.customer_receivables.fn({});
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      current_amount: 0, overdue_30: 80, overdue_60: 0, overdue_90: 70, total: 150,
    });
  });
});
