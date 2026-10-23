-- Per-user pinned notifications. A pinned notification stays at the top of
-- that user's list (oldest pin first) until they unpin or delete it.
CREATE TABLE IF NOT EXISTS notification_pins (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_pins_user ON notification_pins(user_id, pinned_at);
