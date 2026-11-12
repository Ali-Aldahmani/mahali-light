-- Migration 066: demand history that forecasts and training data can trust
-- (sales forecasting ML readiness audit 2026-11-12, P0).
--
-- sales_history_monthly:
--   units_sold      customer purchases only; exchange replacements are no
--                   longer counted as new sales
--   replacement_qty units handed out in exchanges (new)
--   return_qty      customer returns, dated by the ORIGINAL sale's month
--                   (supplier returns are no longer counted)
--   net_units       units_sold + replacement_qty - return_qty (new): what
--                   customers kept, by the month they bought it
--
-- sales_history_aggregated_months: which months have been aggregated, so a
-- month with no row is a real zero, and a month never aggregated is missing,
-- not zero.
--
-- v_sales_demand_lines: one row per sold line, safe to export. It never
-- joins cost batches (which repeat a line once per batch), marks exchange
-- replacements, carries units returned against the line, and gives the
-- sale's store day and hour.

ALTER TABLE sales_history_monthly ADD COLUMN IF NOT EXISTS replacement_qty DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_history_monthly ADD COLUMN IF NOT EXISTS net_units DECIMAL(12,2);

CREATE TABLE IF NOT EXISTS sales_history_aggregated_months (
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  aggregated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year, month)
);

CREATE OR REPLACE VIEW v_sales_demand_lines AS
SELECT ii.id AS invoice_item_id,
       i.id AS invoice_id,
       i.confirmed_at AS sold_at,
       (i.confirmed_at AT TIME ZONE COALESCE(NULLIF(current_setting('app.store_timezone', true), ''), 'Asia/Dubai'))::date AS store_day,
       EXTRACT(HOUR FROM i.confirmed_at AT TIME ZONE COALESCE(NULLIF(current_setting('app.store_timezone', true), ''), 'Asia/Dubai'))::int AS store_hour,
       ii.product_id,
       ii.variant_id,
       ii.sku,
       ii.unit_label,
       ii.quantity,
       ii.unit_price,
       ii.discount_amount,
       ii.line_total,
       i.pc_identifier,
       EXISTS (SELECT 1 FROM return_orders ro WHERE ro.replacement_invoice_id = i.id) AS is_exchange_replacement,
       COALESCE((
         SELECT SUM(rri.quantity)
           FROM return_request_items rri
           JOIN return_requests rr ON rr.id = rri.return_request_id
          WHERE rri.invoice_item_id = ii.id AND rr.executed_at IS NOT NULL
       ), 0) AS quantity_returned
  FROM invoice_items ii
  JOIN invoices i ON i.id = ii.invoice_id
 WHERE i.status = 'confirmed';
