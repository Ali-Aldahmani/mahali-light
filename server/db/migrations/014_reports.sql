-- Phase 14: Reports system (scheduled report jobs + payroll inputs).

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type VARCHAR(50) NOT NULL,
  frequency VARCHAR(20) NOT NULL,
  -- daily / weekly / monthly
  send_time TIME DEFAULT '08:00',
  day_of_week INT,
  -- 1-7 for weekly (1=Monday)
  day_of_month INT,
  -- 1-28 for monthly
  recipients JSONB NOT NULL,
  -- [{ employee_id, name, email }]
  format VARCHAR(10) DEFAULT 'pdf',
  filters JSONB,
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  last_status VARCHAR(20),
  -- success / failed
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_active_freq
  ON scheduled_reports(is_active, frequency);

-- Payroll inputs on the employee profile.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS base_salary  DECIMAL(12,2) DEFAULT 0;
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS salary_type  VARCHAR(20)   DEFAULT 'monthly';
-- monthly / daily / hourly
