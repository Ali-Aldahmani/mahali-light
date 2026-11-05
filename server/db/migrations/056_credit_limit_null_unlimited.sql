-- Decision (review 5 Nov 2026): a credit limit of 0 meant "unlimited", and new
-- customers defaulted to 0, so anyone who could add a customer could sell to
-- them on unlimited credit.
--
-- Now NULL means no limit and 0 means no credit sales. Existing customers keep
-- exactly what they had: every 0 becomes NULL. New customers default to 0, and
-- lifting that needs customer.edit_credit_limit (migration 055).

ALTER TABLE customers ALTER COLUMN credit_limit DROP NOT NULL;
UPDATE customers SET credit_limit = NULL WHERE credit_limit = 0;
ALTER TABLE customers ALTER COLUMN credit_limit SET DEFAULT 0;
