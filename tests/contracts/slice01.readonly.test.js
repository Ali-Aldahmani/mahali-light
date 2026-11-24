/**
 * Slice 01: the forecast GET helpers only read. Looking up a variant that has
 * no recommendation or plan must not insert one.
 *
 * Runs on its own throwaway database on an explicitly selected test server,
 * like tests/integration. It used to load the real .env and query whatever
 * database that named (engineering audit F-TST-01), and passed without
 * checking anything when that database was unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('slice 01 GET is read-only', () => {
  let db, admin;
  const database = `slice01_readonly_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;

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
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.closePool();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('getReorderForVariant and getAnnualPlanForVariant do not insert', async () => {
    const forecast = require('../../server/services/forecastService.js');
    const count = async (table) => (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;
    const rrBefore = await count('reorder_recommendations');
    const apBefore = await count('annual_stock_plans');

    const missing = randomUUID();
    expect(await forecast.getReorderForVariant(missing)).toBeNull();
    expect(await forecast.getAnnualPlanForVariant(missing, 2024)).toBeNull();

    expect(await count('reorder_recommendations')).toBe(rrBefore);
    expect(await count('annual_stock_plans')).toBe(apBefore);
  });
});
