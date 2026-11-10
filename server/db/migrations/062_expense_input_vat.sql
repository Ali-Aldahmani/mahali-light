-- Recoverable input VAT on operating expenses and bills.
--
-- An expense or bill payment amount is what was paid, VAT included. The VAT
-- part is posted to 2002 (VAT payable, debit = recoverable) and only the rest
-- to the expense account, so expenses are not overstated and the VAT return
-- claims it. Rows from before this migration have no VAT (0), as they were
-- booked.

ALTER TABLE one_time_expenses ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE one_time_expenses DROP CONSTRAINT IF EXISTS chk_expense_vat;
ALTER TABLE one_time_expenses ADD CONSTRAINT chk_expense_vat CHECK (vat_amount >= 0 AND vat_amount <= amount);

-- The VAT rate a bill is charged at (0 = no VAT); each payment's VAT is
-- worked out from what was paid unless given.
ALTER TABLE bills ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE bills DROP CONSTRAINT IF EXISTS chk_bill_vat_rate;
ALTER TABLE bills ADD CONSTRAINT chk_bill_vat_rate CHECK (vat_rate >= 0 AND vat_rate <= 100);

ALTER TABLE bill_payments ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE bill_payments DROP CONSTRAINT IF EXISTS chk_bill_payment_vat;
ALTER TABLE bill_payments ADD CONSTRAINT chk_bill_payment_vat CHECK (vat_amount >= 0);
