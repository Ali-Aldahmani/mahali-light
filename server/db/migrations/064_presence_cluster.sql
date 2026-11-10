-- Migration 064: presence across several backend instances, and Last Seen
-- after sign-out (presence audit 2026-11-10).
--
-- socket_io_attachments: used by @socket.io/postgres-adapter for messages
-- too large for NOTIFY, when SOCKET_CLUSTER=postgres.
--
-- idx_sessions_user_activity: Last Seen is the latest activity over all of a
-- user's sessions, open or closed (Users page).

CREATE TABLE IF NOT EXISTS socket_io_attachments (
  id          BIGSERIAL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  payload     BYTEA
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_activity
  ON user_sessions (user_id, last_activity_at DESC);
