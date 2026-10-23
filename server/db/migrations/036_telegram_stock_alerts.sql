-- Telegram stock alerts.
--
-- One settings row (bot token + chat). The token is a secret: it is never
-- returned to the browser in full (see telegramController).
CREATE TABLE IF NOT EXISTS telegram_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT false,
  bot_token TEXT,
  bot_username VARCHAR(100),
  chat_id VARCHAR(64),
  chat_title VARCHAR(200),
  -- Only alerts raised after alerts were switched on are sent, so turning
  -- the feature on doesn't flood the chat with every old low-stock item.
  enabled_since TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Delivery tracking per reorder alert (outbox style: the sender job picks up
-- pending alerts that haven't been sent yet).
ALTER TABLE reorder_alerts ADD COLUMN IF NOT EXISTS telegram_sent_at TIMESTAMPTZ;
ALTER TABLE reorder_alerts ADD COLUMN IF NOT EXISTS telegram_attempts INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_reorder_alerts_telegram_unsent
  ON reorder_alerts(created_at)
  WHERE telegram_sent_at IS NULL AND status = 'pending';
