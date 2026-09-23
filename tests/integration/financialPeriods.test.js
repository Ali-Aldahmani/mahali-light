/**
 * Financial period rollover regression test.
 *
 * Periods were only seeded for 2026 and a new month was created only when
 * the previous one was closed, so from 2027-01-01 every journal posting —
 * i.e. every sale, payment, refund and PO receipt — failed with
 * BIZ_PERIOD_NOT_FOUND. Posting now provisions the covering periods on
 * demand; closed periods must still block.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('financial periods beyond the seeded year on real PostgreSQL', () => {
  let db, admin, journal, cashId, capitalId;
  const database = `financial_periods_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

  function entry(date) {
    return {
      date,
      description: `Test entry ${date}`,
      lines: [
        { accountId: cashId, debit: 10, credit: 0 },
        { accountId: capitalId, debit: 0, credit: 10 },
      ],
    };
  }

  async function periodsNamed(names) {
    const { rows } = await db.query(
      `SELECT name, period_type, start_date::text AS start, end_date::text AS end, status
         FROM financial_periods WHERE name = ANY($1) ORDER BY name`,
      [names],
    );
    return rows;
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
    journal = require('../../server/services/journalService');
    journal.invalidateAccountsCache();
    cashId = await journal.getAccountIdByCode('1001');
    capitalId = await journal.getAccountIdByCode('3001');
  });

  afterAll(async () => {
    if (db) await db.getPool().end();
    if (admin) {
      if (createdDatabase) await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('posts into an unseeded year and provisions its periods', async () => {
    const result = await journal.postJournalEntry(entry('2027-01-15'));
    expect(result.entry.entry_number).toMatch(/^JE-2027-/);
    expect(await periodsNamed(['January 2027', 'Q1 2027', 'H1 2027', 'FY 2027'])).toEqual([
      { name: 'FY 2027', period_type: 'yearly', start: '2027-01-01', end: '2027-12-31', status: 'open' },
      { name: 'H1 2027', period_type: 'yearly', start: '2027-01-01', end: '2027-06-30', status: 'open' },
      { name: 'January 2027', period_type: 'monthly', start: '2027-01-01', end: '2027-01-31', status: 'open' },
      { name: 'Q1 2027', period_type: 'quarterly', start: '2027-01-01', end: '2027-03-31', status: 'open' },
    ]);
  });

  it('books an instant by the Dubai business day, in both JS and SQL', async () => {
    // 00:30 on 1 Jan 2028 in Dubai = 20:30 UTC on 31 Dec 2027.
    const instant = new Date('2027-12-31T20:30:00Z');
    const result = await journal.postJournalEntry(entry(instant));
    const { rows: [row] } = await db.query(
      `SELECT je.date::text AS date, p.name
         FROM journal_entries je JOIN financial_periods p ON p.id = je.period_id
        WHERE je.id = $1`,
      [result.entry.id],
    );
    expect(row).toEqual({ date: '2028-01-01', name: 'January 2028' });

    const { rows: [sql] } = await db.query(
      `SELECT current_setting('TimeZone') AS tz, ($1::timestamptz)::date::text AS day`,
      [instant.toISOString()],
    );
    expect(sql).toEqual({ tz: 'Asia/Dubai', day: '2028-01-01' });
  });

  it('survives concurrent first postings into a brand-new month', async () => {
    await Promise.all([
      journal.postJournalEntry(entry('2027-05-03')),
      journal.postJournalEntry(entry('2027-05-04')),
      journal.postJournalEntry(entry('2027-05-05')),
    ]);
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM financial_periods WHERE name = 'May 2027' AND period_type = 'monthly'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it('still refuses postings into a closed period', async () => {
    const { rows: [period] } = await db.query(
      `SELECT id FROM financial_periods WHERE name = 'January 2027' AND period_type = 'monthly'`,
    );
    await journal.closePeriod({ periodId: period.id, force: true });
    await expect(journal.postJournalEntry(entry('2027-01-20'))).rejects.toMatchObject({
      code: 'BIZ_PERIOD_CLOSED',
    });
  });

  it('closing December provisions the next January with correct boundaries', async () => {
    await journal.ensurePeriodsForYear(2028);
    await db.query(`DELETE FROM financial_periods WHERE name LIKE '% 2029'`);
    const { rows: [dec] } = await db.query(
      `SELECT id FROM financial_periods WHERE name = 'December 2028' AND period_type = 'monthly'`,
    );
    await journal.closePeriod({ periodId: dec.id, force: true });
    expect(await periodsNamed(['January 2029'])).toEqual([
      { name: 'January 2029', period_type: 'monthly', start: '2029-01-01', end: '2029-01-31', status: 'open' },
    ]);
  });

  it('provisions a whole year idempotently', async () => {
    await journal.ensurePeriodsForYear(2030);
    await journal.ensurePeriodsForYear(2030);
    const { rows } = await db.query(
      `SELECT period_type, COUNT(*)::int AS n FROM financial_periods
        WHERE name LIKE '% 2030' GROUP BY period_type ORDER BY period_type`,
    );
    expect(rows).toEqual([
      { period_type: 'monthly', n: 12 },
      { period_type: 'quarterly', n: 4 },
      { period_type: 'yearly', n: 3 },
    ]);
  });
});
