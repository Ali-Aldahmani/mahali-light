const { query } = require('../db/postgres');

// Per-product revenue, cost of goods and gross profit, on the same basis as the
// ledger P&L, so the product figures for any period add up to it:
//
//  - Revenue is ex-VAT and after every discount. An invoice-level discount is
//    shared across the invoice's lines in proportion to their value.
//  - A customer return counts in the period it happened, as the journal books
//    it: it takes its ex-VAT value and its original cost back off the product.
//    A no-invoice return has no VAT to reverse and no sale to read a cost from,
//    so it uses its full value and today's cost.
//  - An exchange is a return of the old product plus a sale of the new one at
//    its full price, so each product carries its own share. A replacement
//    invoice records only the price difference in taxable_amount, which is why
//    its lines are not scaled like an ordinary invoice's.
//  - A warranty replacement is left out: its cost is booked to warranty expense
//    (5016), below gross profit.
//
// Cost is the snapshot taken on each sale line (latest purchase cost), the
// store's accounting policy. batch_cost_total is what the units actually came
// out of their cost batches at (migration 059), for comparison; sales from
// before batches existed count at the line's cost.
//
// Card processing fees (payment_fees) are shared across an invoice's lines in
// proportion to their value, and come off gross profit to give contribution
// profit, as in the P&L.
const SORT_COLUMNS = {
  revenue: 'revenue',
  profit: 'gross_profit',
  quantity: 'units_sold',
  margin: 'margin_pct',
  contribution: 'contribution_profit',
};

async function getProductProfit({
  startDate,
  endDate,
  sortBy = 'revenue',
  descending = true,
  limit = null,
  groupBy = 'product',
}) {
  const sortCol = SORT_COLUMNS[sortBy] || SORT_COLUMNS.revenue;
  const direction = descending ? 'DESC' : 'ASC';
  // Lines with no product are custom/third-party items: their name is all that
  // identifies them.
  const groupColumns = [
    'm.product_id',
    'CASE WHEN m.product_id IS NULL THEN lower(m.product_name) END',
    ...(groupBy === 'variant' ? ['m.variant_id'] : []),
  ].join(', ');
  const variantColumn = groupBy === 'variant' ? 'm.variant_id' : 'NULL::uuid';
  const params = [startDate, endDate];
  const limitClause = limit == null ? '' : `LIMIT $${params.push(limit)}`;

  const { rows } = await query(
    `WITH line_batch_cost AS (
       SELECT invoice_item_id, SUM(quantity * unit_cost) AS cost
         FROM inventory_batch_allocations
        WHERE invoice_item_id IS NOT NULL
        GROUP BY invoice_item_id
     ),
     movements AS (
       SELECT ii.product_id, ii.variant_id, ii.product_name, ii.sku, ii.invoice_id,
              ii.quantity AS sold_qty,
              0::numeric AS returned_qty,
              CASE
                WHEN EXISTS (SELECT 1 FROM return_orders ro WHERE ro.replacement_invoice_id = i.id)
                  THEN ii.line_total
                ELSE COALESCE(
                  ii.line_total * i.taxable_amount
                    / NULLIF(SUM(ii.line_total) OVER (PARTITION BY ii.invoice_id), 0),
                  0)
              END AS revenue,
              ii.quantity * ii.cost_price_at_time AS cost,
              CASE WHEN ii.cost_price_at_time = 0 AND ii.line_total > 0
                   THEN ii.quantity ELSE 0 END AS missing_cost_qty,
              COALESCE(lb.cost, ii.quantity * ii.cost_price_at_time) AS batch_cost,
              0::numeric AS fees
         FROM invoice_items ii
         LEFT JOIN line_batch_cost lb ON lb.invoice_item_id = ii.id
         JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status = 'confirmed'
          AND i.confirmed_at::date BETWEEN $1::date AND $2::date
          AND NOT EXISTS (SELECT 1 FROM warranty_claims wc WHERE wc.replacement_invoice_id = i.id)
       UNION ALL
       SELECT COALESCE(ii.product_id, rri.product_id), rri.variant_id,
              COALESCE(ii.product_name, rri.product_name), COALESCE(ii.sku, v.sku), NULL,
              0,
              rri.quantity,
              -rri.total_value / (1 + COALESCE(orig.tax_rate, 0) / 100),
              -rri.quantity * COALESCE(ii.cost_price_at_time, v.cost_price, 0),
              0,
              -rri.quantity * COALESCE(lb.cost / NULLIF(ii.quantity, 0), ii.cost_price_at_time, v.cost_price, 0),
              0
         FROM return_request_items rri
         LEFT JOIN line_batch_cost lb ON lb.invoice_item_id = rri.invoice_item_id
         JOIN return_orders ro ON ro.return_request_id = rri.return_request_id
         LEFT JOIN invoice_items ii ON ii.id = rri.invoice_item_id
         LEFT JOIN invoices orig ON orig.id = ii.invoice_id
         LEFT JOIN product_variants v ON v.id = rri.variant_id
        WHERE ro.created_at::date BETWEEN $1::date AND $2::date
          AND ro.return_type IN ('customer_refund', 'customer_replace')
       UNION ALL
       SELECT ii.product_id, ii.variant_id, ii.product_name, ii.sku, NULL,
              0, 0, 0, 0, 0, 0,
              f.amount * ii.line_total / NULLIF(SUM(ii.line_total) OVER (PARTITION BY f.id), 0)
         FROM payment_fees f
         JOIN invoice_items ii ON ii.invoice_id = f.invoice_id AND ii.line_total > 0
        WHERE f.fee_date BETWEEN $1::date AND $2::date
     ),
     grouped AS (
       SELECT m.product_id,
              ${variantColumn} AS variant_id,
              MAX(m.product_name) AS snapshot_name,
              CASE WHEN COUNT(DISTINCT m.sku) = 1 THEN MIN(m.sku) ELSE '' END AS sku,
              COUNT(DISTINCT m.variant_id)::int AS variant_count,
              SUM(m.sold_qty)::float8 AS gross_units,
              SUM(m.returned_qty)::float8 AS returned_qty,
              SUM(m.sold_qty - m.returned_qty)::float8 AS units_sold,
              SUM(m.revenue)::float8 AS revenue,
              SUM(m.cost)::float8 AS cost_total,
              SUM(m.revenue - m.cost)::float8 AS gross_profit,
              SUM(m.missing_cost_qty)::float8 AS missing_cost_qty,
              SUM(m.fees)::float8 AS payment_fees,
              SUM(m.revenue - m.cost - m.fees)::float8 AS contribution_profit,
              SUM(m.batch_cost)::float8 AS batch_cost_total,
              SUM(m.revenue - m.batch_cost)::float8 AS batch_gross_profit,
              COUNT(DISTINCT m.invoice_id)::int AS invoice_count
         FROM movements m
        GROUP BY ${groupColumns}
     )
     SELECT g.*,
            COALESCE(p.name, g.snapshot_name) AS product_name,
            CASE WHEN g.gross_units > 0 THEN g.returned_qty / g.gross_units * 100 ELSE 0 END
              AS return_rate_pct,
            CASE WHEN g.revenue > 0 THEN g.gross_profit / g.revenue * 100 ELSE 0 END
              AS margin_pct,
            p.image_path,
            pc.name AS category_name
       FROM grouped g
       LEFT JOIN products p ON p.id = g.product_id
       LEFT JOIN product_categories pc ON pc.id = p.category_id
      ORDER BY ${sortCol} ${direction}, product_name ASC
      ${limitClause}`,
    params,
  );
  return rows;
}

module.exports = { getProductProfit };
