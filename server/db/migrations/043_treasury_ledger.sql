-- Migration 043: treasury, stock and the ledger agree (audit fix Phase 4).
--
-- Additive only.
--
-- 1. Two expense accounts the new journal postings need:
--    5015 Cash Over/Short — the counted-vs-expected difference when the
--         drawer is closed (short = debit, over = credit).
--    5016 Warranty Expense — the cost of a unit handed out as a warranty
--         replacement.
--
-- 2. Supplier payment reversals keep the original payment. Instead of
--    deleting the row, a reversal marks it reversed (who, when, why); totals
--    and lists skip reversed payments, and the receipt file is kept as
--    evidence. Same idea as customer_payment_voids for customer payments.

INSERT INTO chart_of_accounts (code, name, type, is_system, description) VALUES
  ('5015', 'Cash Over/Short', 'expense', true,
   'Counted cash minus expected cash at drawer close. Shortages debit, overages credit.'),
  ('5016', 'Warranty Expense', 'expense', true,
   'Cost of units given out as warranty replacements.')
ON CONFLICT (code) DO NOTHING;

UPDATE chart_of_accounts c
   SET parent_id = p.id
  FROM chart_of_accounts p
 WHERE p.code = '5000'
   AND c.code IN ('5015', '5016')
   AND c.parent_id IS NULL;

ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE INDEX IF NOT EXISTS supplier_payments_live_idx
  ON supplier_payments (purchase_order_id)
  WHERE reversed_at IS NULL;
