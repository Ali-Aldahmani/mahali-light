-- Migration 040: one row per money or stock command, keyed by the client.
--
-- A form generates a key when it opens and sends it with the request
-- (Idempotency-Key header). The command and this row commit in the same
-- transaction, so a retry with the same key — after a timeout, a lost
-- response or a double click — finds the row and returns the original
-- result instead of paying, receiving or moving stock a second time.
--
-- payload_hash catches a key reused for a different request (409).
-- Rows are kept as long as the records they protect. Additive only.

CREATE TABLE IF NOT EXISTS operations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        VARCHAR(60)  NOT NULL,
  key          VARCHAR(128) NOT NULL,
  payload_hash CHAR(64)     NOT NULL,
  result       JSONB,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (scope, key)
);

CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations (created_at);
