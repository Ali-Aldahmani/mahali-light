/**
 * Sales forecasting ML readiness audit 2026-11-12, P0 fixes.
 *
 * Against a real database, with sale rows written directly so each case is exact:
 * - exchange replacements are not new sales (units or revenue)
 * - customer returns land on the month of the sale, even when made later;
 *   supplier returns and cancelled sales are not demand
 * - reorder and annual-plan demand count every month, zeros included; a
 *   month never aggregated is unknown, not zero
 * - v_sales_demand_lines gives one row per sold line, whatever the batches
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('forecast demand history on real PostgreSQL', () => {
  let db, admin, forecast, productId, variantId;
  const database = `forecast_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  let n = 0;
  const months = {}; // label -> { year, month, mid: 'YYYY-MM-15 12:00' }

  const monthsAgo = (k) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - k);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    return { year, month, mid: `${year}-${String(month).padStart(2, '0')}-15 12:00:00+04` };
  };

  async function sale(qty, at, { status = 'confirmed', price = 100, taxable = null } = {}) {
    n += 1;
    const total = taxable ?? qty * price;
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, confirmed_at, created_at, subtotal, taxable_amount, total)
       VALUES ($1, $2, $3, $3, $4, $4, $4) RETURNING id`, [`T-${n}-${randomUUID().slice(0, 6)}`, status, at, total]);
    const { rows: [line] } = await db.query(
      `INSERT INTO invoice_items (invoice_id, product_id, variant_id, product_name, quantity, unit_price, cost_price_at_time,
                                  line_subtotal, line_total)
       VALUES ($1,$2,$3,'Fan',$4,$5,40,$6,$6) RETURNING id`, [inv.id, productId, variantId, qty, price, qty * price]);
    return { invoiceId: inv.id, lineId: line.id };
  }
  async function returnOrder(qty, type, { originalInvoiceId = null, replacementInvoiceId = null, at = 'NOW()' } = {}) {
    n += 1;
    const { rows: [ro] } = await db.query(
      `INSERT INTO return_orders (return_order_number, return_type, original_invoice_id, replacement_invoice_id, created_at)
       VALUES ($1, $2, $3, $4, ${at === 'NOW()' ? 'NOW()' : '$5'}) RETURNING id`,
      at === 'NOW()' ? [`RO-${n}`, type, originalInvoiceId, replacementInvoiceId] : [`RO-${n}`, type, originalInvoiceId, replacementInvoiceId, at]);
    await db.query(
      `INSERT INTO return_order_items (return_order_id, product_id, variant_id, product_name, quantity, unit_price, total_value, condition, stock_action)
       VALUES ($1,$2,$3,'Fan',$4,100,$5,'good','returned_to_stock')`, [ro.id, productId, variantId, qty, qty * 100]);
  }
  const row = async (m) => (await db.query(
    `SELECT units_sold::float8, replacement_qty::float8, return_qty::float8, net_units::float8, revenue::float8, invoice_count
       FROM sales_history_monthly WHERE variant_id = $1 AND year = $2 AND month = $3`, [variantId, m.year, m.month])).rows[0];

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
    forecast = require('../../server/services/forecastService');
    ({ rows: [{ id: productId }] } = await db.query(`INSERT INTO products (name, is_active) VALUES ('Fan', true) RETURNING id`));
    ({ rows: [{ id: variantId }] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, is_active) VALUES ($1,'FAN-1',100,40,50,true) RETURNING id`, [productId]));
    for (const [k, label] of [[1, 'last'], [2, 'm2'], [3, 'm3'], [4, 'm4']]) months[label] = monthsAgo(k);
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  it('a month counts customer purchases; exchanges, supplier returns and cancelled sales are not demand', async () => {
    const m = months.last;
    await sale(15, m.mid);
    const b = await sale(3, m.mid);
    const c = await sale(1, m.mid);
    // Exchange: the unit from sale c comes back, a replacement goes out on a 0-total invoice.
    const repl = await sale(1, m.mid, { taxable: 0 });
    await returnOrder(1, 'customer_replace', { originalInvoiceId: c.invoiceId, replacementInvoiceId: repl.invoiceId, at: m.mid });
    // A refund of one unit of sale b, made THIS month: it belongs to last month's sales.
    await returnOrder(1, 'customer_refund', { originalInvoiceId: b.invoiceId });
    // Goods sent back to a supplier and a cancelled sale are not customer demand.
    await returnOrder(5, 'supplier_return', { at: m.mid });
    await sale(2, m.mid, { status: 'cancelled' });

    await forecast.aggregateMonthlySales({ year: m.year, month: m.month });
    expect(await row(m)).toEqual({
      units_sold: 19, replacement_qty: 1, return_qty: 2, net_units: 18, revenue: 1900, invoice_count: 3,
    });
  });

  it('reorder demand averages over every month, zeros included', async () => {
    // Sold 6 four months ago, nothing in the two months after, then last month (net 18).
    await sale(6, months.m4.mid);
    const res = await forecast.aggregatePendingMonths();
    expect(res.months).toBeGreaterThanOrEqual(4);
    const series = await forecast.netMonthlySeries(variantId, { sinceMonths: 12 });
    expect(series.map((r) => r.units)).toEqual([6, 0, 0, 18]);
    const days = series.reduce((s, r) => s + r.days, 0);
    const rec = await forecast.calculateReorderRecommendation(variantId);
    expect(rec.based_on_months).toBe(4);
    expect(rec.daily_avg_sales).toBeCloseTo(24 / days, 3);
    // Counting only the two selling months would have doubled it.
    expect(rec.daily_avg_sales).toBeLessThan(24 / 61);
  });

  it('a month never aggregated is unknown, not zero', async () => {
    await db.query(`DELETE FROM sales_history_aggregated_months WHERE year = $1 AND month = $2`, [months.m2.year, months.m2.month]);
    const series = await forecast.netMonthlySeries(variantId, { sinceMonths: 12 });
    expect(series.map((r) => `${r.month}:${r.units}`)).toEqual(
      [`${months.m4.month}:6`, `${months.m3.month}:0`, `${months.last.month}:18`]);
    // The next run fills it in.
    await forecast.aggregatePendingMonths();
    expect((await forecast.netMonthlySeries(variantId, { sinceMonths: 12 })).length).toBe(4);
  });

  it('the annual plan averages each calendar month over the years since the first sale, zeros included', async () => {
    const plan = await forecast.calculateAnnualStockPlan(variantId, new Date().getUTCFullYear() + 1);
    const byMonth = Object.fromEntries((plan.plan || plan.months || plan).map((p) => [p.month, p.historical_avg]));
    expect(byMonth[months.m3.month]).toBe(0);
    expect(byMonth[months.last.month]).toBe(18);
  });

  it('v_sales_demand_lines has one row per sold line, whatever the cost batches', async () => {
    const s = await sale(4, months.last.mid);
    const { rows: [batch] } = await db.query(
      `INSERT INTO inventory_batches (product_id, variant_id, unit_cost) VALUES ($1,$2,41) RETURNING id`, [productId, variantId]);
    const { rows: [batch2] } = await db.query(
      `INSERT INTO inventory_batches (product_id, variant_id, unit_cost) VALUES ($1,$2,43) RETURNING id`, [productId, variantId]);
    await db.query(`INSERT INTO inventory_batch_allocations (batch_id, invoice_item_id, quantity, unit_cost) VALUES ($1,$3,2,41), ($2,$3,2,43)`,
      [batch.id, batch2.id, s.lineId]);
    // One unit returned against this line.
    n += 1;
    const { rows: [rr] } = await db.query(
      `INSERT INTO return_requests (request_number, return_type, reason, request_note, status, executed_at)
       VALUES ($1, 'customer_refund', 'defective', 'test', 'completed', NOW()) RETURNING id`, [`RR-${n}`]);
    await db.query(
      `INSERT INTO return_request_items (return_request_id, product_id, variant_id, invoice_item_id, product_name, quantity, unit_price, total_value, condition)
       VALUES ($1,$2,$3,$4,'Fan',1,100,100,'good')`, [rr.id, productId, variantId, s.lineId]);
    const { rows } = await db.query(`SELECT quantity::float8, quantity_returned::float8, store_day::text, store_hour, is_exchange_replacement
                                        FROM v_sales_demand_lines WHERE invoice_item_id = $1`, [s.lineId]);
    expect(rows).toEqual([{
      quantity: 4, quantity_returned: 1,
      store_day: `${months.last.year}-${String(months.last.month).padStart(2, '0')}-15`, store_hour: 12, is_exchange_replacement: false,
    }]);
  });
});
