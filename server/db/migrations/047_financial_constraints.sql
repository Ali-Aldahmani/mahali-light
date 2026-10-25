-- Migration 047: the database itself enforces the core money and stock
-- rules (atomicity audit TXA-011, invoice audit F21).
--
-- Until now only the services checked these; any other writer (a script,
-- a future code path, a manual fix) could store impossible values. The
-- CHECKs are added NOT VALID: they apply to every new insert and update,
-- but existing rows aren't re-checked, so an old bad row can't block the
-- upgrade. Once the reconciliation report is clean, each can be validated
-- with ALTER TABLE ... VALIDATE CONSTRAINT <name>.
--
-- Bank balances are left out on purpose: withdrawals may overdraw a bank
-- account when the user allows it.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('product_variants',        'chk_variant_stock_nonneg',       'stock_qty >= 0'),
    ('product_variants',        'chk_variant_quarantine_nonneg',  'quarantine_qty >= 0'),
    ('cash_drawer',             'chk_drawer_balance_nonneg',      'current_balance >= 0'),
    ('customers',               'chk_customer_balance_nonneg',    'credit_balance >= 0'),
    ('purchase_order_items',    'chk_po_item_received_range',     'quantity_received >= 0 AND quantity_received <= quantity'),
    ('purchase_order_items',    'chk_po_item_quantity_pos',       'quantity > 0'),
    ('invoice_items',           'chk_invoice_item_quantity_pos',  'quantity > 0'),
    ('invoice_payments',        'chk_invoice_payment_amount_pos', 'amount > 0'),
    ('supplier_payments',       'chk_supplier_payment_amount_pos','amount > 0'),
    ('customer_payments',       'chk_customer_payment_amount_pos','amount > 0'),
    ('refund_payments',         'chk_refund_payment_amount_pos',  'amount > 0'),
    ('one_time_expenses',       'chk_expense_amount_pos',         'amount > 0'),
    -- Closing rows record 0; every other movement is positive.
    ('cash_drawer_transactions','chk_cash_tx_amount_nonneg',      'amount >= 0'),
    ('bank_transactions',       'chk_bank_tx_amount_pos',         'amount > 0')
  ) AS t(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.tbl, c.name, c.expr);
    END IF;
  END LOOP;
END $$;

-- Every journal entry must balance. Checked at commit (deferred), so an
-- entry's lines can still be inserted one by one inside its transaction.
CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger AS $$
DECLARE
  entry_id UUID := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  diff NUMERIC;
BEGIN
  SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO diff
    FROM journal_lines WHERE journal_entry_id = entry_id;
  IF ABS(diff) > 0.005 THEN
    RAISE EXCEPTION 'journal entry % is not balanced (debits - credits = %)', entry_id, diff
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();
