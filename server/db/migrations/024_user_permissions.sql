-- Migration 024: per-user permission overrides.
--
-- Allows granting extra permissions to a specific user beyond their role, or
-- explicitly denying role permissions for that user.
--
-- Resolution order in loadUserContext():
--   1. Start with the user's role permissions.
--   2. Apply user_permissions rows:
--        granted = true  → add the permission (even if the role doesn't have it)
--        granted = false → remove the permission (even if the role does have it)
--
-- The UI sends the full desired "effective" set; the backend computes the delta
-- vs. role permissions and persists only the rows that differ from the role.

CREATE TABLE IF NOT EXISTS user_permissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id UUID    NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id
    ON user_permissions (user_id);
