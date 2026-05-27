-- Phase 18: Error logs & bug reports.

CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  severity VARCHAR(20) NOT NULL,
  -- info / warning / error / critical
  source VARCHAR(30) NOT NULL DEFAULT 'api',
  -- api / electron / backup / sync / scheduler
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  pc_identifier VARCHAR(50),
  endpoint VARCHAR(200),
  method VARCHAR(10),
  stack_trace TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number VARCHAR(50) NOT NULL UNIQUE,
  reported_by UUID REFERENCES users(id) ON DELETE SET NULL,
  pc_identifier VARCHAR(50),
  app_version VARCHAR(20),
  os_info VARCHAR(100),
  screen VARCHAR(200),
  what_were_you_doing TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  urgency VARCHAR(20) NOT NULL,
  -- blocking / major / minor
  screenshot_path VARCHAR(500),
  error_code VARCHAR(100),
  stack_trace TEXT,
  breadcrumbs JSONB DEFAULT '[]'::jsonb,
  device_info JSONB,
  status VARCHAR(20) DEFAULT 'open',
  -- open / in_progress / resolved / wont_fix
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bug_report_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bug_report_id UUID REFERENCES bug_reports(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  commented_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_code ON error_logs(code);
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON error_logs(resolved);

CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_urgency ON bug_reports(urgency);
CREATE INDEX IF NOT EXISTS idx_bug_reports_reported_by ON bug_reports(reported_by);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bug_report_comments_report
  ON bug_report_comments(bug_report_id);
