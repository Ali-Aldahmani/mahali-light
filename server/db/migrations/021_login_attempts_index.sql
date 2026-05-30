-- Migration 021: index on login_attempts to speed up the lockout window query.
--
-- isLockedOut() in authController.js runs on every login attempt:
--
--   SELECT COUNT(*)::int AS fails
--     FROM login_attempts
--    WHERE username = $1
--      AND success = false
--      AND attempted_at > NOW() - make_interval(mins => $2)
--
-- Without an index, Postgres does a full sequential scan of login_attempts on
-- every request.  The composite index on (username, attempted_at DESC) lets the
-- planner satisfy both the equality filter on username and the range filter on
-- attempted_at using an index-only scan.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_login_attempts_username_attempted_at
    ON login_attempts (username, attempted_at DESC);
