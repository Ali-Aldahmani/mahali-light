-- Migration 041: one sale attempt, one invoice.
--
-- The POS creates a checkout ID when a sale starts and keeps it (also in
-- the sale backup) until the sale is done. Creating the draft with an ID
-- that already has an invoice returns that invoice instead of a second one,
-- and GET /invoices/checkout/:checkoutId tells the POS whether a sale whose
-- response was lost actually went through. Additive only; older invoices
-- have no checkout ID.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_id VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_checkout_id_idx
  ON invoices (checkout_id)
  WHERE checkout_id IS NOT NULL;
