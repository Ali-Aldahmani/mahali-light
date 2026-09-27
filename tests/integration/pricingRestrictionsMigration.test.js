/**
 * Migration 034 (multiple pricing restrictions per product) must keep every
 * legacy single-restriction row from 031 valid and enforced. Seeds rows in
 * the pre-034 schema, migrates forward, then checks data and enforcement.
 *
 * Creates and drops its own database on an explicitly selected local test
 * server, like the other tests in tests/integration.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('pricing restriction migration 034 on real PostgreSQL', () => {
  let db, admin;
  const database = `pricing_restriction_migration_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const products = {};

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
    const { runMigrations } = require('../../server/db/migrate');

    await runMigrations({ stopBefore: '034_' });

    const legacy = [
      ['min', 'MINIMUM_PRICE', 50, null, null],
      ['pct', 'MAX_DISCOUNT_PERCENT', null, 10, null],
      ['amt', 'MAX_DISCOUNT_AMOUNT', null, null, 5],
    ];
    for (const [key, type, min, pct, amt] of legacy) {
      const { rows } = await db.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [`Legacy ${key}`]);
      products[key] = rows[0].id;
      await db.query(
        `INSERT INTO pricing_restrictions (product_id, restriction_type, min_price, max_discount_percent, max_discount_amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [rows[0].id, type, min, pct, amt],
      );
    }

    await runMigrations();
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('keeps every legacy row and its value', async () => {
    const { rows } = await db.query(
      `SELECT product_id, min_price, max_discount_percent, max_discount_amount FROM pricing_restrictions`,
    );
    const byProduct = new Map(rows.map((r) => [r.product_id, r]));
    expect(rows).toHaveLength(3);
    expect(Number(byProduct.get(products.min).min_price)).toBe(50);
    expect(Number(byProduct.get(products.pct).max_discount_percent)).toBe(10);
    expect(Number(byProduct.get(products.amt).max_discount_amount)).toBe(5);
    expect(byProduct.get(products.min).max_discount_percent).toBeNull();
  });

  it('legacy rows are still enforced as a single enabled rule', async () => {
    const svc = require('../../server/services/pricingRestrictionService');
    const map = await svc.getRestrictionsMap(null, Object.values(products));
    const check = (key, net) =>
      svc.evaluatePriceRestrictions({ restriction: map.get(products[key]), catalogPrice: 100, netUnitPrice: net })
        .map((v) => v.restrictionType);
    expect(check('min', 49)).toEqual(['MINIMUM_PRICE']);
    expect(check('min', 60)).toEqual([]);
    expect(check('pct', 85)).toEqual(['MAX_DISCOUNT_PERCENT']);
    expect(check('amt', 90)).toEqual(['MAX_DISCOUNT_AMOUNT']);
  });

  it('legacy rows can gain additional rules after migration', async () => {
    await db.query(
      `UPDATE pricing_restrictions SET max_discount_percent = 5 WHERE product_id = $1`,
      [products.min],
    );
    const { rows } = await db.query(
      `SELECT min_price, max_discount_percent FROM pricing_restrictions WHERE product_id = $1`,
      [products.min],
    );
    expect(Number(rows[0].min_price)).toBe(50);
    expect(Number(rows[0].max_discount_percent)).toBe(5);
  });
});
