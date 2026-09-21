-- Migration 030: configurable store tagline shown under the store name in
-- the sidebar (was hardcoded as "Electrical · POS").

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS store_tagline VARCHAR(100) DEFAULT 'Electrical · POS';
