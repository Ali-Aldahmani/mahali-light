/**
 * Supplier rankings (Analytics -> Suppliers): delivery honesty, price on
 * shared items, volume delivered. Seeds four suppliers with known outcomes
 * and checks every tier, plus the rules that keep the ranking fair:
 *   - drafts, cancelled POs and POs outside the period are ignored,
 *   - an order still not delivered after its promised date counts as late,
 *   - no expected date -> promised = confirmation + default lead time,
 *   - price only compares items bought from 2+ suppliers, and is hidden
 *     from users without product.view_cost.
 *
 * Creates and drops its own database, mirroring the other integration suites.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

const svc = require('../../server/services/supplierRankingService');

describe('supplier ranking tiers', () => {
  it('splits suppliers into thirds by volume', () => {
    expect(svc.relativeTiers(0)).toEqual([]);
    expect(svc.relativeTiers(1)).toEqual(['single']);
    expect(svc.relativeTiers(2)).toEqual(['more', 'less']);
    expect(svc.relativeTiers(3)).toEqual(['more', 'mid', 'less']);
    expect(svc.relativeTiers(5)).toEqual(['more', 'more', 'mid', 'less', 'less']);
  });

  it('rates delivery only with enough deliveries', () => {
    expect(svc.deliveryTier(2, 100)).toBe('insufficient');
    expect(svc.deliveryTier(3, 90)).toBe('honest');
    expect(svc.deliveryTier(3, 75)).toBe('mid');
    expect(svc.deliveryTier(3, 50)).toBe('low');
  });

  it('price tiers use a +/-3% band around the market price', () => {
    expect(svc.priceTier(-3)).toBe('lowest');
    expect(svc.priceTier(0)).toBe('mid');
    expect(svc.priceTier(3)).toBe('expensive');
  });
});

describe.skipIf(!enabled)('supplier rankings on real PostgreSQL', () => {
  let db, admin, app, request, adminToken;
  const database = `supplier_rankings_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const ids = {};
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const range = { startDate: day(-60), endDate: day(0) };
  let poSeq = 0;

  // expected/received are day offsets from today (null = not set / not yet).
  async function po(supplier, { status = 'received', ordered = -30, expected = -20, received = -20 } = {}) {
    poSeq += 1;
    const { rows: [r] } = await db.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, order_date, confirmed_at, expected_date, received_date, status)
       VALUES ($1, $2, $3::date, $3::date, $4::date, $5::date, $6) RETURNING id`,
      [`PO-T-${poSeq}`, ids[supplier], day(ordered), expected == null ? null : day(expected),
       received == null ? null : day(received), status],
    );
    return r.id;
  }
  async function received(supplier, item, cost, qty, when = -20) {
    const poId = await po(supplier);
    await db.query(
      `INSERT INTO product_cost_history (product_id, variant_id, purchase_order_id, supplier_id, cost_price, quantity_bought, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date)`,
      [ids[`${item}_p`], ids[item], poId, ids[supplier], cost, qty, day(when)],
    );
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

    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
      const { rows: [s] } = await db.query(
        `INSERT INTO suppliers (name, default_lead_time_days) VALUES ($1, 3) RETURNING id`, [name]);
      ids[name] = s.id;
    }
    for (const [key, sku] of [['X', 'SKU-X'], ['Y', 'SKU-Y'], ['Z', 'SKU-Z']]) {
      const { rows: [p] } = await db.query(
        `INSERT INTO products (name, sold_by, unit_label, is_active) VALUES ($1, 'piece', 'pcs', true) RETURNING id`,
        [`Item ${key}`]);
      const { rows: [v] } = await db.query(
        `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
         VALUES ($1, $2, $2, 50, 10, 0, true) RETURNING id`, [p.id, sku]);
      ids[`${key}_p`] = p.id;
      ids[key] = v.id;
    }

    // Delivery. Alpha: 4 on time (one early). Beta: 3 on time, 1 four days late.
    // Gamma: 1 on time, 1 six days late, 1 never delivered (due 5 days ago).
    // Delta: 1 order, no expected date (promised = ordered + 3 days), on time.
    for (const received of [-20, -21, -20, -20]) await po('Alpha', { received });
    for (const received of [-20, -20, -20, -16]) await po('Beta', { received });
    await po('Gamma', { received: -20 });
    await po('Gamma', { received: -14 });
    await po('Gamma', { status: 'confirmed', ordered: -10, expected: -5, received: null });
    await po('Delta', { ordered: -30, expected: null, received: -28 });
    // Ignored: Gamma draft/cancelled, Beta order before the period, and an
    // Alpha order not due yet.
    await po('Gamma', { status: 'draft', received: null, expected: -40 });
    await po('Gamma', { status: 'cancelled', received: null, expected: -40 });
    await po('Beta', { ordered: -100, expected: -90, received: -50 });
    await po('Alpha', { status: 'confirmed', ordered: -2, expected: 5, received: null });

    // Price + volume (each receipt adds an on-time PO, so the delivery
    // counts above grow by one per line here).
    await received('Alpha', 'X', 10, 100);
    await received('Alpha', 'Y', 20, 50);
    await received('Beta', 'X', 12, 10);
    await received('Gamma', 'Y', 26, 5);
    await received('Gamma', 'Z', 1, 30); // only Gamma sells Z: not comparable
    await received('Delta', 'Z', 1, 1, -90); // outside the period

    const auth = require('../../server/middleware/auth');
    const { rows: [u] } = await db.query(`SELECT id FROM users WHERE username = 'admin'`);
    adminToken = auth.signToken({ sub: u.id });
    await db.query(
      `INSERT INTO user_sessions (user_id, pc_identifier, token_hash) VALUES ($1,'test',$2)`,
      [u.id, auth.hashToken(adminToken)],
    );
    const express = require('express');
    request = require('supertest');
    app = express();
    app.use(express.json());
    app.use('/analytics', require('../../server/routes/analytics'));
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  const pick = (rows, keys) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));

  it('ranks delivery honesty from promised vs real delivery dates', async () => {
    const { delivery } = await svc.getSupplierRankings({ ...range, includeCost: true });
    expect(pick(delivery, ['supplierName', 'evaluated', 'onTime', 'openLate', 'tier'])).toEqual([
      { supplierName: 'Alpha', evaluated: 6, onTime: 6, openLate: 0, tier: 'honest' },
      { supplierName: 'Beta', evaluated: 5, onTime: 4, openLate: 0, tier: 'mid' },
      { supplierName: 'Gamma', evaluated: 5, onTime: 3, openLate: 1, tier: 'low' },
      { supplierName: 'Delta', evaluated: 2, onTime: 2, openLate: 0, tier: 'insufficient' },
    ]);
    // Gamma: 6 days late + 5 days overdue and counting, over 5 orders.
    expect(delivery[2].avgDaysLate).toBe(2.2);
  });

  it('compares price only on items bought from more than one supplier', async () => {
    const { price, priceNotComparable } = await svc.getSupplierRankings({ ...range, includeCost: true });
    // X: Alpha 10 vs Beta 12 (avg 11). Y: Alpha 20 vs Gamma 26 (avg 23).
    expect(pick(price, ['supplierName', 'sharedItems', 'cheapestOn', 'pricePct', 'tier'])).toEqual([
      { supplierName: 'Alpha', sharedItems: 2, cheapestOn: 2, pricePct: -11.1, tier: 'lowest' },
      { supplierName: 'Beta', sharedItems: 1, cheapestOn: 0, pricePct: 9.1, tier: 'expensive' },
      { supplierName: 'Gamma', sharedItems: 1, cheapestOn: 0, pricePct: 13, tier: 'expensive' },
    ]);
    expect(priceNotComparable).toEqual([]);
  });

  it('ranks volume by quantity actually delivered in the period', async () => {
    const { volume } = await svc.getSupplierRankings({ ...range, includeCost: true });
    expect(pick(volume, ['supplierName', 'quantity', 'products', 'tier', 'value'])).toEqual([
      { supplierName: 'Alpha', quantity: 150, products: 2, tier: 'more', value: 2000 },
      { supplierName: 'Gamma', quantity: 35, products: 2, tier: 'mid', value: 160 },
      { supplierName: 'Beta', quantity: 10, products: 1, tier: 'less', value: 120 },
    ]);
  });

  it('hides cost-based figures without product.view_cost', async () => {
    const res = await svc.getSupplierRankings({ ...range, includeCost: false });
    expect(res.price).toBeNull();
    expect(res.priceNotComparable).toBeNull();
    expect(res.volume.every((r) => !('value' in r))).toBe(true);
  });

  it('serves GET /analytics/supplier-rankings', async () => {
    const res = await request(app)
      .get(`/analytics/supplier-rankings?start_date=${range.startDate}&end_date=${range.endDate}`)
      .auth(adminToken, { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body.data.delivery[0].supplierName).toBe('Alpha');
    expect(res.body.data.price).not.toBeNull();
  });
});
