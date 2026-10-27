-- Migration 051: session lifetime (authentication audit AUTH-02, AUTH-03).
--
-- A sign-in token now lasts 30 minutes and the app swaps it for a new one
-- before then (/auth/refresh). Two limits sit around that:
--
-- * absolute_expires_at: a session ends this long after sign-in (12 hours by
--   default, SESSION_MAX_HOURS), however often its token is refreshed.
--   Before, refreshing could keep a session alive forever.
-- * previous_token_hash / token_rotated_at: after a refresh the token it
--   replaced keeps working for one minute, so a request already on its way
--   (a sale being confirmed) isn't refused because the token changed mid-air.
--
-- Open sessions get login time + 12 hours; older ones close at the next
-- sweep, as they would have under the new rule.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_token_hash VARCHAR(64);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS token_rotated_at TIMESTAMPTZ;

UPDATE user_sessions
   SET absolute_expires_at = COALESCE(login_at, NOW()) + INTERVAL '12 hours'
 WHERE absolute_expires_at IS NULL AND logout_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_previous_token_hash
  ON user_sessions (previous_token_hash) WHERE previous_token_hash IS NOT NULL;
