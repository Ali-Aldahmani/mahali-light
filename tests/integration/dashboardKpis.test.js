/**
 * Dashboard KPI / return-refund regression test.
 *
 * getKPIs() (the /api/analytics/kpis dashboard tile) computed revenue and
 * profit purely from `invoices` — a customer refund/replace never touched
 * those columns, so processing a return never moved revenue, gross profit,
 * or net profit on the dashboard even though the underlying sale had been
 * reversed (reported directly against the live app). Fixed by netting a
 * customer-facing return's value and COGS out of the period totals.
 *
 * A second bug surfaced while fixing the first: `return_orders.total_value`
 * is tax-INCLUSIVE (the actual refunded amount) while `revenue` is
 * `taxable_amount`, tax-EXCLUSIVE — naively subtracting one from the other
 * overshot (a full refund of a $500+5%VAT invoice dropped revenue to -$25
 * instead of $0). Fixed by de-taxing the return's value using the original
 * invoice's own tax_rate before netting.
 *
 * Creates and drops its own database on an explicitly selected local test
 * server, mirroring tests/integration/invoiceIntegrity.test.js.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const enabled = Boolean(process.env.INVOICE_TEST_PG_PORT);

describe.skipIf(!enabled)('dashboard KPIs react to returns on real PostgreSQL', () => {
  let db, analyticsService, admin;
  let productId, variantId, customerId, supplierId;
  const database = `kpi_regression_${randomUUID().replaceAll('-', '')}`;
  let createdDatabase = false;
  const today = new Date().toISOString().slice(0, 10);

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
    analyticsService = require('../../server/services/analyticsService');

    const { rows: [cat] } = await db.query(`INSERT INTO product_categories (name) VALUES ('Cables') RETURNING id`);
    const { rows: [prod] } = await db.query(
      `INSERT INTO products (name, category_id, sold_by, unit_label, is_active) VALUES ('Test Wire', $1, 'piece', 'pcs', true) RETURNING id`,
      [cat.id],
    );
    productId = prod.id;
    const { rows: [variant] } = await db.query(
      `INSERT INTO product_variants (product_id, sku, internal_barcode, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, 'SKU-KPI-1', 'BC-KPI-1', 100, 60, 45, true) RETURNING id`,
      [productId],
    );
    variantId = variant.id;
    const { rows: [customer] } = await db.query(`INSERT INTO customers (name, credit_balance, credit_limit) VALUES ('Test Customer', 0, 5000) RETURNING id`);
    customerId = customer.id;
    const { rows: [supplier] } = await db.query(`INSERT INTO suppliers (name) VALUES ('Test Supplier') RETURNING id`);
    supplierId = supplier.id;
  }, 30000);

  afterAll(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    if (db) await db.getPool().end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    if (admin) await admin.end();
  });

  async function makeConfirmedInvoice({ number, taxable, tax, total, qty, unitPrice, costPrice }) {
    const { rows: [inv] } = await db.query(
      `INSERT INTO invoices (invoice_number, status, customer_id, subtotal, discount_amount, taxable_amount, tax_amount, total, amount_paid, balance_due, payment_status, confirmed_at)
       VALUES ($1, 'confirmed', $2, $3, 0, $3, $4, $5, $5, 0, 'paid', NOW()) RETURNING id`,
      [number, customerId, taxable, tax, total],
    );
    await db.query(
      `INSERT INTO invoice_items (invoice_id, product_id, variant_id, product_name, sku, unit_label, quantity, unit_price, cost_price_at_time, line_subtotal, line_total)
       VALUES ($1,$2,$3,'Test Wire','SKU-KPI-1','pcs',$4,$5,$6,$7,$7)`,
      [inv.id, productId, variantId, qty, unitPrice, costPrice, taxable],
    );
    return inv.id;
  }

  it('a full customer refund nets that invoice back to zero revenue/profit, not negative', async () => {
    const invId = await makeConfirmedInvoice({
      number: 'INV-KPI-A', taxable: 500, tax: 25, total: 525, qty: 5, unitPrice: 100, costPrice: 60,
    });

    const before = await analyticsService.getKPIs({ start_date: today, end_date: today });
    expect(before.revenue).toBe(500);
    expect(before.gross_profit).toBe(200); // 500 revenue - 300 cogs (5*60)
    expect(before.net_profit).toBe(200);

    const { rows: [ro] } = await db.query(
      `INSERT INTO return_orders (return_order_number, return_type, customer_id, original_invoice_id, total_value, refund_total, status)
       VALUES ('RO-KPI-A', 'customer_refund', $1, $2, 525, 525, 'completed') RETURNING id`,
      [customerId, invId],
    );
    await db.query(
      `INSERT INTO return_order_items (return_order_id, product_id, variant_id, product_name, quantity, unit_label, unit_price, total_value, condition, stock_action)
       VALUES ($1,$2,$3,'Test Wire',5,'pcs',100,525,'good','returned_to_stock')`,
      [ro.id, productId, variantId],
    );

    const after = await analyticsService.getKPIs({ start_date: today, end_date: today });
    expect(after.revenue).toBe(0);
    expect(after.gross_profit).toBe(0);
    expect(after.net_profit).toBe(0);
  });

  it('a partial return only reduces revenue/profit proportionally', async () => {
    const invId = await makeConfirmedInvoice({
      number: 'INV-KPI-B', taxable: 1000, tax: 50, total: 1050, qty: 10, unitPrice: 100, costPrice: 60,
    });
    const before = await analyticsService.getKPIs({ start_date: today, end_date: today });

    // Return 2 of the 10 units: total_value = 2*100*1.05 = 210 (tax-inclusive).
    const { rows: [ro] } = await db.query(
      `INSERT INTO return_orders (return_order_number, return_type, customer_id, original_invoice_id, total_value, refund_total, status)
       VALUES ('RO-KPI-B', 'customer_refund', $1, $2, 210, 210, 'completed') RETURNING id`,
      [customerId, invId],
    );
    await db.query(
      `INSERT INTO return_order_items (return_order_id, product_id, variant_id, product_name, quantity, unit_label, unit_price, total_value, condition, stock_action)
       VALUES ($1,$2,$3,'Test Wire',2,'pcs',100,210,'good','returned_to_stock')`,
      [ro.id, productId, variantId],
    );

    const after = await analyticsService.getKPIs({ start_date: today, end_date: today });
    // Revenue should drop by exactly 200 (the tax-exclusive value of 2 units), not 210.
    expect(after.revenue).toBe(before.revenue - 200);
    // COGS reversal: 2 * 60 = 120.
    expect(after.gross_profit).toBe(before.gross_profit - 200 + 120);
  });

  it('a supplier return does not affect sales revenue at all', async () => {
    const before = await analyticsService.getKPIs({ start_date: today, end_date: today });

    const { rows: [ro] } = await db.query(
      `INSERT INTO return_orders (return_order_number, return_type, supplier_id, total_value, refund_total, status)
       VALUES ('RO-KPI-C', 'supplier_return', $1, 300, 0, 'completed') RETURNING id`,
      [supplierId],
    );
    await db.query(
      `INSERT INTO return_order_items (return_order_id, product_id, variant_id, product_name, quantity, unit_label, unit_price, total_value, condition, stock_action)
       VALUES ($1,$2,$3,'Test Wire',5,'pcs',60,300,'defective','disposed')`,
      [ro.id, productId, variantId],
    );

    const after = await analyticsService.getKPIs({ start_date: today, end_date: today });
    expect(after.revenue).toBe(before.revenue);
    expect(after.gross_profit).toBe(before.gross_profit);
  });
});
