-- Nullable for historical payments. New API requests must supply a key.
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_payments_idempotency_idx
  ON invoice_payments (invoice_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
