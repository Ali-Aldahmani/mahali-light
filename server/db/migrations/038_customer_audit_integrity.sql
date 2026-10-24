-- Customer profile audit integrity. Additive only: new nullable columns, a
-- new archive table and an append-only guard. No existing row is rewritten.

-- Event-time actor name, so history keeps the username used at the time
-- even if the user is renamed later. Null on rows written before this.
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS performed_by_name VARCHAR(100);

-- Voided balance payments. The live row is still removed from
-- customer_payments (every report keeps reading only live payments), but a
-- full copy lands here first so the collection and its reversal stay visible.
CREATE TABLE IF NOT EXISTS customer_payment_voids (
  id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_id UUID,
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  bank_account_id UUID,
  payment_date DATE NOT NULL,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_payment_voids_customer
  ON customer_payment_voids(customer_id);

-- Retry-safe customer creation. Null for historical rows.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS request_key VARCHAR(128);
CREATE UNIQUE INDEX IF NOT EXISTS customers_request_key_idx
  ON customers (request_key) WHERE request_key IS NOT NULL;

-- Activity log is append-only. The one update allowed is the FK action
-- that nulls performed_by when a user row is hard-deleted.
CREATE OR REPLACE FUNCTION activity_log_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.performed_by IS NULL
     AND OLD.performed_by IS NOT NULL
     AND (to_jsonb(NEW) - 'performed_by') = (to_jsonb(OLD) - 'performed_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'activity_log is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activity_log_append_only ON activity_log;
CREATE TRIGGER activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW EXECUTE FUNCTION activity_log_append_only();
