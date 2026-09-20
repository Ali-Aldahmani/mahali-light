-- Backfill missing foreign keys on payment-adjacent tables (audit finding
-- MED-05): customer_payments.invoice_id, and bank_account_id on
-- customer_payments / invoice_payments / refund_payments were left as plain
-- UUID columns with only a comment pointing at the intended reference,
-- unlike the equivalent pattern already enforced elsewhere in this schema
-- (reorder_alerts.suggested_supplier_id in 004, bills.bank_account_id in
-- 012). A typo'd or stale id in these columns was previously silently
-- accepted; joins on them silently dropped rows.
--
-- Any existing row whose id doesn't match a live parent row is nulled out
-- first (ON DELETE SET NULL is the constraint's own policy going forward,
-- so this just applies that same policy retroactively to data that
-- predates the constraint) so this migration never fails on a database
-- that already has orphaned references.

UPDATE customer_payments SET invoice_id = NULL
 WHERE invoice_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = customer_payments.invoice_id);

UPDATE customer_payments SET bank_account_id = NULL
 WHERE bank_account_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.id = customer_payments.bank_account_id);

UPDATE invoice_payments SET bank_account_id = NULL
 WHERE bank_account_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.id = invoice_payments.bank_account_id);

UPDATE refund_payments SET bank_account_id = NULL
 WHERE bank_account_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.id = refund_payments.bank_account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_invoice_id_fkey'
  ) THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_payments_bank_account_id_fkey'
  ) THEN
    ALTER TABLE customer_payments
      ADD CONSTRAINT customer_payments_bank_account_id_fkey
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payments_bank_account_id_fkey'
  ) THEN
    ALTER TABLE invoice_payments
      ADD CONSTRAINT invoice_payments_bank_account_id_fkey
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'refund_payments_bank_account_id_fkey'
  ) THEN
    ALTER TABLE refund_payments
      ADD CONSTRAINT refund_payments_bank_account_id_fkey
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_payments_bank_account ON customer_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_bank_account ON invoice_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_refund_payments_bank_account ON refund_payments(bank_account_id);
