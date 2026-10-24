-- Migration 039: separate warranty edit and void permissions.
--
-- Editing (PUT /warranties/:id) and voiding (POST /warranties/:id/void) used
-- to require only warranty.create, which the default Cashier role holds, so
-- any cashier could rewrite or cancel any customer's warranty. They now need
-- warranty.edit / warranty.void.
--
-- System roles are re-synced from shared/permissions.js by the seeder on
-- every start (Manager and Admin get both; Cashier does not). Custom roles
-- and per-user grants are not, so to keep them working exactly as before,
-- every custom role — and every user override — that grants warranty.create
-- also gets the two new permissions. Additive only.

INSERT INTO permissions (key, label, module) VALUES
  ('warranty.edit', 'Edit Warranty', 'warranty'),
  ('warranty.void', 'Void Warranty', 'warranty')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
  FROM role_permissions rp
  JOIN permissions p_create ON p_create.id = rp.permission_id AND p_create.key = 'warranty.create'
  JOIN roles r ON r.id = rp.role_id AND r.is_system = false
  CROSS JOIN permissions p_new
 WHERE p_new.key IN ('warranty.edit', 'warranty.void')
ON CONFLICT DO NOTHING;

INSERT INTO user_permissions (user_id, permission_id, granted)
SELECT up.user_id, p_new.id, true
  FROM user_permissions up
  JOIN permissions p_create ON p_create.id = up.permission_id AND p_create.key = 'warranty.create'
  CROSS JOIN permissions p_new
 WHERE up.granted = true
   AND p_new.key IN ('warranty.edit', 'warranty.void')
ON CONFLICT (user_id, permission_id) DO NOTHING;
