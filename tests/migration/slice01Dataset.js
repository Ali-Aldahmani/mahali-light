/**
 * Deterministic Slice 01 fixture rows. Tagged for cleanup. No production PII.
 */
const TAG = 'slice01-parity-fixture';
const bcrypt = require('bcrypt');

async function cleanup(query) {
  await query(
    `DELETE FROM invoices WHERE notes = $1 OR invoice_number LIKE $2`,
    [TAG, `${TAG}-%`],
  );
  await query(`DELETE FROM sales_history_monthly WHERE product_id IN (
    SELECT id FROM products WHERE name LIKE $1)`, [`${TAG}%`]);
  await query(`DELETE FROM annual_stock_plans WHERE product_id IN (
    SELECT id FROM products WHERE name LIKE $1)`, [`${TAG}%`]);
  await query(`DELETE FROM reorder_recommendations WHERE product_id IN (
    SELECT id FROM products WHERE name LIKE $1)`, [`${TAG}%`]);
  await query(`DELETE FROM product_variants WHERE sku LIKE $1`, [`${TAG}-%`]);
  await query(`DELETE FROM products WHERE name LIKE $1`, [`${TAG}%`]);
  await query(`DELETE FROM product_categories WHERE name LIKE $1`, [`${TAG}%`]);
  await query(`DELETE FROM users WHERE username LIKE $1`, [`${TAG}-%`]);
}

async function seed(query) {
  await cleanup(query);

  const cat = await query(
    `INSERT INTO product_categories (name, is_active) VALUES ($1, true) RETURNING id`,
    [`${TAG}-cat`],
  );
  const categoryId = cat.rows[0].id;

  async function product(name, sku, stock, cost) {
    const p = await query(
      `INSERT INTO products (name, category_id, unit_label, is_active)
       VALUES ($1, $2, 'pcs', true) RETURNING id`,
      [name, categoryId],
    );
    const v = await query(
      `INSERT INTO product_variants (product_id, sku, selling_price, cost_price, stock_qty, is_active)
       VALUES ($1, $2, 10, $3, $4, true) RETURNING id`,
      [p.rows[0].id, sku, cost, stock],
    );
    return { productId: p.rows[0].id, variantId: v.rows[0].id };
  }

  const reorderYes = await product(`${TAG} Cable`, `${TAG}-sku-low`, 2, 4);
  const reorderNo = await product(`${TAG} Switch`, `${TAG}-sku-ok`, 80, 3);
  const histRich = await product(`${TAG} Panel`, `${TAG}-sku-hist`, 10, 5);
  const histPoor = await product(`${TAG} Clip`, `${TAG}-sku-thin`, 10, 1);

  await query(
    `INSERT INTO reorder_recommendations
       (product_id, variant_id, recommended_qty, based_on_months, daily_avg_sales,
        lead_time_days, safety_buffer_days, reorder_point, peak_month,
        is_peak_season, peak_multiplier, confidence, calculated_at)
     VALUES
       ($1,$2,20,12,1.5,7,7,10.5,7,false,2,'high','2024-06-01T00:00:00Z'),
       ($3,$4,5,6,0.1,7,7,1,1,false,2,'medium','2024-06-01T00:00:00Z')`,
    [reorderYes.productId, reorderYes.variantId, reorderNo.productId, reorderNo.variantId],
  );

  const year = 2024;
  for (let m = 1; m <= 12; m += 1) {
    await query(
      `INSERT INTO annual_stock_plans
         (product_id, variant_id, year, month, recommended_qty, estimated_cost, basis)
       VALUES ($1,$2,$3,$4,$5,$6,'historical')`,
      [histRich.productId, histRich.variantId, year, m, m * 2, m * 10],
    );
  }

  for (let m = 1; m <= 24; m += 1) {
    const y = m <= 12 ? 2023 : 2024;
    const month = m <= 12 ? m : m - 12;
    const units = month === 7 ? 50 : 10;
    await query(
      `INSERT INTO sales_history_monthly
         (product_id, variant_id, year, month, units_sold, revenue)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [histRich.productId, histRich.variantId, y, month, units, units * 10],
    );
  }
  await query(
    `INSERT INTO sales_history_monthly (product_id, variant_id, year, month, units_sold, revenue)
     VALUES ($1,$2,2024,1,3,30)`,
    [histPoor.productId, histPoor.variantId],
  );

  async function invoice(number, at, total) {
    const inv = await query(
      `INSERT INTO invoices
         (invoice_number, status, taxable_amount, total, confirmed_at, notes)
       VALUES ($1, 'confirmed', $2, $2, $3, $4)
       RETURNING id`,
      [number, total, at, TAG],
    );
    await query(
      `INSERT INTO invoice_items
         (invoice_id, product_id, variant_id, product_name, quantity, unit_price,
          cost_price_at_time, line_subtotal, line_total)
       VALUES ($1,$2,$3,$4,1,$5,1,$5,$5)`,
      [inv.rows[0].id, reorderYes.productId, reorderYes.variantId, `${TAG} Cable`, total],
    );
    return inv.rows[0].id;
  }

  await invoice(`${TAG}-in-10`, '2024-01-15 10:00:00', 100);
  await invoice(`${TAG}-in-10b`, '2024-01-15 10:30:00', 50);
  await invoice(`${TAG}-in-14`, '2024-01-15 14:00:00', 20);
  await invoice(`${TAG}-out`, '2024-03-20 11:00:00', 999);

  const missingVariant = '00000000-0000-4000-8000-000000000099';

  const cashierRole = await query(`SELECT id FROM roles WHERE name = 'Cashier'`);
  let cashier = null;
  if (cashierRole.rows.length) {
    const hash = await bcrypt.hash('slice01-test', Number(process.env.BCRYPT_ROUNDS || 4));
    const u = await query(
      `INSERT INTO users (username, password_hash, role_id, is_active)
       VALUES ($1,$2,$3,true) RETURNING id`,
      [`${TAG}-cashier`, hash, cashierRole.rows[0].id],
    );
    cashier = { username: `${TAG}-cashier`, password: 'slice01-test', id: u.rows[0].id };
  }

  return {
    tag: TAG,
    categoryId,
    reorderYes,
    reorderNo,
    histRich,
    histPoor,
    missingVariant,
    cashier,
    rangeInside: { start_date: '2024-01-01', end_date: '2024-01-31' },
    rangeOutside: { start_date: '2023-01-01', end_date: '2023-01-31' },
  };
}

module.exports = { TAG, seed, cleanup };
