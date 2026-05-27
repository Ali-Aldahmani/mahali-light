-- Phase 20 — harden user_sessions: store sha256(token) instead of the
-- raw JWT so that a DB read breach does not yield usable session tokens.
--
-- pgcrypto is already enabled by 001_init.sql; digest() is available.
--
-- Order of operations:
--   1. Add nullable token_hash column.
--   2. Backfill all existing rows from the plaintext token column.
--   3. Enforce NOT NULL.
--   4. Add a unique index on token_hash (replaces the old token index).
--   5. Drop the old plaintext-token index.
--   6. Drop the plaintext token column.

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);

UPDATE user_sessions
   SET token_hash = encode(digest(token, 'sha256'), 'hex')
 WHERE token_hash IS NULL;

ALTER TABLE user_sessions
  ALTER COLUMN token_hash SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash
  ON user_sessions(token_hash);

DROP INDEX IF EXISTS idx_sessions_token;

ALTER TABLE user_sessions
  DROP COLUMN IF EXISTS token;
