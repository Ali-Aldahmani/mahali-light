-- Phase 16: Notifications System.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) DEFAULT 'info',
  -- info / warning / error / critical
  category VARCHAR(30) NOT NULL,
  -- stock / invoice / return / warranty / attendance / bill / finance
  -- system / approval / report
  reference_type VARCHAR(50),
  reference_id UUID,
  action_url VARCHAR(300),
  target_roles JSONB,
  target_user_ids JSONB,
  is_broadcast BOOLEAN DEFAULT false,
  dedupe_key VARCHAR(200),
  -- Optional batch / dedupe key so repeated events fold into one row.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  dismissed BOOLEAN DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  UNIQUE (notification_id, user_id)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  stock_alerts      BOOLEAN DEFAULT true,
  invoice_alerts    BOOLEAN DEFAULT true,
  return_alerts     BOOLEAN DEFAULT true,
  warranty_alerts   BOOLEAN DEFAULT true,
  attendance_alerts BOOLEAN DEFAULT true,
  bill_alerts       BOOLEAN DEFAULT true,
  finance_alerts    BOOLEAN DEFAULT true,
  system_alerts     BOOLEAN DEFAULT true,
  approval_alerts   BOOLEAN DEFAULT true,
  report_alerts     BOOLEAN DEFAULT true,
  show_info     BOOLEAN DEFAULT true,
  show_warning  BOOLEAN DEFAULT true,
  show_error    BOOLEAN DEFAULT true,
  show_critical BOOLEAN DEFAULT true,
  sound_enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON notifications(category);
CREATE INDEX IF NOT EXISTS idx_notifications_type
  ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_dedupe
  ON notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_reads_user
  ON notification_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_reads_notif
  ON notification_reads(notification_id);

-- Backfill: every existing user gets a default preferences row so the API
-- can always SELECT a single row without LEFT JOIN gymnastics.
INSERT INTO notification_preferences (user_id)
  SELECT id FROM users
   WHERE id NOT IN (SELECT user_id FROM notification_preferences WHERE user_id IS NOT NULL)
  ON CONFLICT (user_id) DO NOTHING;
