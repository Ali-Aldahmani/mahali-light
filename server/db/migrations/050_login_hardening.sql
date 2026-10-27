-- Migration 050: login hardening (authentication audit AUTH-05, AUTH-07).
--
-- 1. One open session per user per PC. Login closes the old session and
--    opens a new one; two logins at the same moment could both find nothing
--    to close and both insert, leaving two valid tokens. Login now takes a
--    lock first, and this index makes the database refuse a second open
--    session too. Existing duplicates are closed as 'replaced' (keeping the
--    newest), which is what login would have done.
--
-- 2. Lockout state. Lockout used to count rows in login_attempts and then
--    record the attempt in a separate query, so parallel guesses all saw
--    "fewer than five" and went through, and anyone who knew a username
--    could lock that person out from any PC. Now each attempt is counted in
--    one atomic upsert per username and address before the password is
--    checked, a success clears it, and an Admin can unlock. login_attempts
--    stays as the audit trail.

UPDATE user_sessions s
   SET logout_at = NOW(), logout_type = 'replaced', status = 'offline'
 WHERE s.logout_at IS NULL
   AND EXISTS (
     SELECT 1 FROM user_sessions newer
      WHERE newer.user_id = s.user_id
        AND newer.pc_identifier = s.pc_identifier
        AND newer.logout_at IS NULL
        AND (newer.login_at, newer.id) > (s.login_at, s.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_one_open_per_pc
  ON user_sessions (user_id, pc_identifier)
  WHERE logout_at IS NULL;

CREATE TABLE IF NOT EXISTS login_lockouts (
  username          VARCHAR(50) NOT NULL,
  ip_address        VARCHAR(45) NOT NULL,
  failed_count      INT NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until      TIMESTAMPTZ,
  PRIMARY KEY (username, ip_address)
);
