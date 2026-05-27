-- Phase 17: Backup System.

CREATE TABLE IF NOT EXISTS backup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number VARCHAR(50) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL,
  -- full / db_only / incremental
  status VARCHAR(20) DEFAULT 'running',
  -- running / completed / failed / partial
  triggered_by VARCHAR(20) NOT NULL,
  -- scheduled / manual
  triggered_by_user UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_seconds INT,
  size_bytes BIGINT DEFAULT 0,
  destinations JSONB DEFAULT '[]'::jsonb,
  -- [{type:'local'|'nas'|'usb', path, status:'success'|'failed', error}]
  db_included BOOLEAN DEFAULT true,
  uploads_included BOOLEAN DEFAULT false,
  config_included BOOLEAN DEFAULT false,
  local_file_path VARCHAR(500),
  -- Absolute path of the local copy (download endpoint uses this).
  error_message TEXT,
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  -- Retention manager sets this when the file is purged from local disk.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Schedules
  schedule_6h_enabled BOOLEAN DEFAULT true,
  schedule_nightly_enabled BOOLEAN DEFAULT true,
  schedule_weekly_enabled BOOLEAN DEFAULT true,
  schedule_monthly_enabled BOOLEAN DEFAULT true,
  -- Local storage
  local_enabled BOOLEAN DEFAULT true,
  local_path VARCHAR(500) DEFAULT './backups',
  -- NAS storage
  nas_enabled BOOLEAN DEFAULT false,
  nas_ip VARCHAR(50) DEFAULT '192.168.50.51',
  nas_path VARCHAR(500) DEFAULT '/volume1/pos-backups',
  nas_username VARCHAR(100),
  nas_password_encrypted TEXT,
  -- USB storage
  usb_enabled BOOLEAN DEFAULT true,
  usb_auto_detect BOOLEAN DEFAULT true,
  -- Retention policy
  retention_6h_days INT DEFAULT 7,
  retention_nightly_days INT DEFAULT 30,
  retention_weekly_weeks INT DEFAULT 12,
  retention_monthly_months INT DEFAULT 120,
  -- Notifications
  notify_on_success BOOLEAN DEFAULT false,
  notify_on_failure BOOLEAN DEFAULT true,
  notify_user_ids JSONB DEFAULT '[]'::jsonb,
  -- Compression
  compression_enabled BOOLEAN DEFAULT true,
  compression_level INT DEFAULT 6,
  -- Encryption
  encryption_enabled BOOLEAN DEFAULT false,
  encryption_key_hash TEXT,
  -- pg_dump binary path override (Windows installs vary). Empty = use PATH.
  pg_dump_path VARCHAR(500) DEFAULT '',
  pg_restore_path VARCHAR(500) DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_jobs_status
  ON backup_jobs(status);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_started
  ON backup_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_type
  ON backup_jobs(type);

-- Seed default backup settings (one row).
INSERT INTO backup_settings (id)
  SELECT gen_random_uuid()
   WHERE NOT EXISTS (SELECT 1 FROM backup_settings);
