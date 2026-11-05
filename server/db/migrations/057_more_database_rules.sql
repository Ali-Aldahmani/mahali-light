-- Migration 057: Phase 7 of audit round 2 (SI-05, INV-010). The database
-- enforces more of the rules the services already apply, so a script, a future
-- code path or a manual fix can't store impossible values.
--
-- Like 047, every CHECK is NOT VALID: new and changed rows must pass, old rows
-- aren't re-checked, so an old bad row can't block the upgrade. Run
-- scripts/reconcile.js on live data, fix what it lists, then validate each in
-- the next release with ALTER TABLE ... VALIDATE CONSTRAINT <name>.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('invoices',         'chk_invoice_status',            $s$status IN ('draft', 'confirmed', 'cancelled')$s$),
    ('invoices',         'chk_invoice_money_nonneg',      'subtotal >= 0 AND total >= 0 AND tax_amount >= 0 AND invoice_discount >= 0'),
    ('invoice_payments', 'chk_invoice_payment_method',    $s$method IN ('cash', 'bank', 'credit')$s$),
    ('invoice_items',    'chk_invoice_item_money_nonneg', 'unit_price >= 0 AND line_total >= 0 AND COALESCE(discount_amount, 0) >= 0'),
    ('purchase_orders',  'chk_po_status',                 $s$status IN ('draft', 'confirmed', 'partially_received', 'received', 'cancelled')$s$),
    ('purchase_orders',  'chk_po_money_nonneg',           'COALESCE(total_cost, 0) >= 0 AND COALESCE(amount_paid, 0) >= 0'),
    ('customers',        'chk_customer_credit_limit',     'credit_limit IS NULL OR credit_limit >= 0'),
    -- Every movement's after = before + quantity (the reconcile check
    -- movement_arithmetic; quarantine moves store the change to stock on hand).
    ('stock_movements',  'chk_movement_arithmetic',       'ABS(qty_after - (qty_before + quantity)) <= 0.005'),
    ('product_variants', 'chk_variant_prices_nonneg',     'selling_price >= 0 AND cost_price >= 0')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;
