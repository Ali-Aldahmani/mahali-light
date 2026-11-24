-- Migrations 060 (card processing fees) and 063 (payroll) added permission
-- keys without granting them. The boot seed only grants a key on the run
-- that creates it, and on an upgraded install the migration had already
-- created it, so nobody, Admin included, received these permissions
-- (software engineering audit F-MIG-03). A fresh install was unaffected.
--
-- Admin is the only role whose defaults include them (shared/permissions.js
-- ROLE_DEFAULTS: Admin = '*'). Other roles keep whatever an Admin chose.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.name = 'Admin'
   AND p.key IN (
     'finance.manage_payment_fees',
     'payroll.view',
     'payroll.manage',
     'payroll.approve',
     'payroll.pay'
   )
ON CONFLICT DO NOTHING;
