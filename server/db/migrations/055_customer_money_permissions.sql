-- Whole-repo review: two actions on customer money were open to anyone who could
-- edit a customer or take a payment, which includes Cashiers.
--
-- * customer.edit_credit_limit: lifting a limit let a Cashier then sell on credit
--   past it.
-- * customer.void_payment: voiding hands cash back out of the drawer.
--
-- Additive: Admin and Manager gain both, and no existing data changes.

INSERT INTO permissions (key, label, module) VALUES
  ('customer.void_payment', 'Void a Customer Payment', 'customer'),
  ('customer.edit_credit_limit', 'Change a Customer Credit Limit', 'customer')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, module = EXCLUDED.module;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.name IN ('Admin', 'Manager')
   AND p.key IN ('customer.void_payment', 'customer.edit_credit_limit')
ON CONFLICT DO NOTHING;
