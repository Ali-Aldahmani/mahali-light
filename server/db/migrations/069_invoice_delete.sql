-- Deleting invoices (Admin and Manager only).
--
-- * invoice.delete: removes an invoice for good. A confirmed sale is first
--   reversed exactly as Cancel does (stock, cash, bank, ledger, credit), so
--   the books still balance once the invoice row is gone.
-- * Card fees the provider actually charged are a real expense and outlive
--   the invoice: payment_fees.invoice_id no longer blocks the delete and is
--   left empty instead. The deleted invoice's number and contents are kept in
--   activity_log (action 'invoice.deleted').
--
-- Additive: Admin and Manager gain the permission; no existing data changes.

INSERT INTO permissions (key, label, module) VALUES
  ('invoice.delete', 'Delete Invoice', 'invoice')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, module = EXCLUDED.module;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.name IN ('Admin', 'Manager')
   AND p.key = 'invoice.delete'
ON CONFLICT DO NOTHING;

ALTER TABLE payment_fees ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE payment_fees DROP CONSTRAINT IF EXISTS payment_fees_invoice_id_fkey;
ALTER TABLE payment_fees
  ADD CONSTRAINT payment_fees_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
