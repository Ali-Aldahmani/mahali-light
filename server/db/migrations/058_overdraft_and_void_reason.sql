-- Review, 8 Nov 2026.
--
-- * bank.overdraft: taking a bank account below zero needed only a flag from the
--   client. Admin and Manager keep the ability; other roles need it granted.
-- * customer_payment_voids.void_reason: a void now says why. Old rows stay NULL.

INSERT INTO permissions (key, label, module) VALUES
  ('bank.overdraft', 'Take a Bank Account Below Zero', 'bank')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, module = EXCLUDED.module;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.name IN ('Admin', 'Manager') AND p.key = 'bank.overdraft'
ON CONFLICT DO NOTHING;

ALTER TABLE customer_payment_voids ADD COLUMN IF NOT EXISTS void_reason TEXT;
