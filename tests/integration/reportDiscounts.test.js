/**
 * Discount totals in reports.
 *
 * invoices.discount_amount already includes the invoice-level discount
 * (invoice_discount); reports must not add invoice_discount on top. One sale
 * with an AED 20 line discount and an AED 10 invoice discount must report
 * AED 30 everywhere.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('report discount totals on real PostgreSQL', () => {
  let db, admin, reports, analytics, userId;
  const database = `report_discounts_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const range = { start_date: '2026-03-01', end_date: '2026-03-31' };

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
    ({ rows: [{ id: userId }] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`));

    // Subtotal 100, line discount 20 + invoice discount 10 = 30 stored in
    // discount_amount, taxable 70, VAT 5% = 3.50, total 73.50.
    await db.query(
      `INSERT INTO invoices (invoice_number, status, subtotal, discount_amount, invoice_discount,
                             taxable_amount, tax_rate, tax_amount, total, amount_paid, balance_due,
                             payment_status, created_by, confirmed_by, confirmed_at)
       VALUES ('INV-DISC-1', 'confirmed', 100, 30, 10, 70, 5, 3.5, 73.5, 73.5, 0, 'paid', $1, $1,
               '2026-03-10 12:00+04')`,
      [userId],
    );
  }, 30000);

  afterAll(async () => {
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('sales summary counts the discount once', async () => {
    const report = await reports.REGISTRY.sales_summary.fn(range);
    expect(report.summary.discounts).toBe(30);
  });

  it('sales by employee counts the discount once', async () => {
    const report = await reports.REGISTRY.sales_by_employee.fn(range);
    expect(report.rows[0].discounts).toBe(30);
    expect(report.totals.discounts).toBe(30);
  });

  it('employee performance report counts the discount once', async () => {
    const report = await reports.REGISTRY.employee_performance.fn(range);
    expect(report.rows[0].discounts).toBe(30);
  });

  it('analytics discount rate uses the discount once', async () => {
    const [row] = await analytics.getEmployeePerformance({ startDate: range.start_date, endDate: range.end_date });
    // 30 / 73.50 = 40.8%; counting the invoice discount twice gave 54.4%.
    expect(row.discount_rate_pct).toBe(40.8);
  });
});
