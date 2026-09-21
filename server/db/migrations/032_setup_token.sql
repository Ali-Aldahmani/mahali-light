-- One-time setup token hash (plaintext token returned once via GET /setup/status).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS setup_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS setup_token_issued_at TIMESTAMPTZ;
