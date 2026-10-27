-- Migration 054: draft ownership, payment tenders and cash control
-- (sales audit SI-02, SI-03, SI-06; round 1 drawer-close approval).
--
-- * invoices.owner_id: the cashier a draft sale belongs to. Only the owner
--   changes, pays or confirms it; anyone else first takes it over, which
--   moves ownership and is logged (invoice.take_over). Existing drafts
--   belong to whoever created them.
-- * invoice_payments.tender / reference: card or bank transfer, and the
--   slip or transfer reference. Both still post to a bank account (method
--   'bank'), so reports and reversals that read method are unchanged.
-- * cash_drawer_sessions.discrepancy_approved_by: the second person who
--   approved closing with a difference above the tolerance.
-- * New permissions: invoice.take_over (Admin, Manager, Cashier),
--   cash.override_closed_drawer and cash.approve_close (Admin, Manager).

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
UPDATE invoices SET owner_id = created_by WHERE owner_id IS NULL AND status = 'draft';
CREATE INDEX IF NOT EXISTS idx_invoices_owner_draft ON invoices (owner_id) WHERE status = 'draft';

ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS tender VARCHAR(20);
ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS reference VARCHAR(100);

ALTER TABLE cash_drawer_sessions
  ADD COLUMN IF NOT EXISTS discrepancy_approved_by UUID REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO permissions (key, label, module) VALUES
  ('invoice.take_over', 'Take Over Another Cashier''s Draft Sale', 'invoice'),
  ('cash.override_closed_drawer', 'Take Cash With the Drawer Closed', 'cash'),
  ('cash.approve_close', 'Approve Drawer Close Differences', 'cash')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, module = EXCLUDED.module;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE (r.name IN ('Admin', 'Manager', 'Cashier') AND p.key = 'invoice.take_over')
    OR (r.name IN ('Admin', 'Manager') AND p.key IN ('cash.override_closed_drawer', 'cash.approve_close'))
ON CONFLICT DO NOTHING;
