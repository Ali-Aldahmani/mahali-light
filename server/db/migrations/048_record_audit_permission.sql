-- Record-level audit history is more sensitive than the record summary.
-- Add a separate permission without changing or backfilling audit events.
INSERT INTO permissions (key, label, module)
VALUES ('audit.view', 'View Record Audit Logs', 'audit')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, module = EXCLUDED.module;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.name IN ('Admin', 'Manager') AND p.key = 'audit.view'
ON CONFLICT DO NOTHING;
