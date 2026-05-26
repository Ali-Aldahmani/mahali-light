-- Phase 11: Attendance & Leaves.

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  check_in_method VARCHAR(20),
  -- app_login / manual
  check_out_method VARCHAR(20),
  -- app_logout / manual / timeout
  status VARCHAR(20) DEFAULT 'present',
  -- present / absent / late / half_day / leave
  working_hours DECIMAL(5,2),
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  late_minutes INT DEFAULT 0,
  shortage_hours DECIMAL(5,2) DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS attendance_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID REFERENCES attendance(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(50) NOT NULL,
  -- forgot_checkout / wrong_time / system_error / other
  request_note TEXT NOT NULL,
  old_check_in TIMESTAMPTZ,
  old_check_out TIMESTAMPTZ,
  new_check_in TIMESTAMPTZ,
  new_check_out TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'pending',
  -- pending / approved / rejected
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(20) NOT NULL,
  -- annual / sick / unpaid / emergency
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days INT NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  -- pending / approved / rejected / cancelled
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  year INT NOT NULL,
  leave_type VARCHAR(20) NOT NULL,
  entitled_days INT NOT NULL DEFAULT 0,
  used_days INT DEFAULT 0,
  remaining_days INT DEFAULT 0,
  carried_over_days INT DEFAULT 0,
  UNIQUE(employee_id, year, leave_type)
);

CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  date DATE NOT NULL UNIQUE,
  type VARCHAR(20) DEFAULT 'public',
  -- public / company
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date
  ON attendance(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_corrections_status
  ON attendance_corrections(status);
CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves(status);
CREATE INDEX IF NOT EXISTS idx_leaves_dates ON leaves(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee
  ON leave_balances(employee_id, year);

-- Seed UAE public holidays for 2026. Use ON CONFLICT so reruns are no-ops.
INSERT INTO holidays (name, date, type) VALUES
  ('New Year''s Day',          '2026-01-01', 'public'),
  ('Eid Al Fitr',              '2026-03-20', 'public'),
  ('Eid Al Fitr Holiday',      '2026-03-21', 'public'),
  ('Eid Al Fitr Holiday',      '2026-03-22', 'public'),
  ('Arafat Day',               '2026-05-26', 'public'),
  ('Eid Al Adha',              '2026-05-27', 'public'),
  ('Eid Al Adha Holiday',      '2026-05-28', 'public'),
  ('Eid Al Adha Holiday',      '2026-05-29', 'public'),
  ('Islamic New Year',         '2026-06-16', 'public'),
  ('Prophet''s Birthday',      '2026-08-25', 'public'),
  ('Commemoration Day',        '2026-11-30', 'public'),
  ('UAE National Day',         '2026-12-02', 'public'),
  ('UAE National Day',         '2026-12-03', 'public')
ON CONFLICT (date) DO NOTHING;

-- Seed default leave balances for every existing active employee for the
-- current year. Annual = 30, sick = 15, unpaid + emergency tracked but
-- entitlement = 0 (they don't consume balance).
DO $$
DECLARE
  current_year INT := EXTRACT(YEAR FROM NOW())::int;
BEGIN
  INSERT INTO leave_balances (employee_id, year, leave_type, entitled_days, remaining_days)
  SELECT e.id, current_year, 'annual', 30, 30
    FROM employees e WHERE e.is_active = true
   ON CONFLICT (employee_id, year, leave_type) DO NOTHING;

  INSERT INTO leave_balances (employee_id, year, leave_type, entitled_days, remaining_days)
  SELECT e.id, current_year, 'sick', 15, 15
    FROM employees e WHERE e.is_active = true
   ON CONFLICT (employee_id, year, leave_type) DO NOTHING;

  INSERT INTO leave_balances (employee_id, year, leave_type, entitled_days, remaining_days)
  SELECT e.id, current_year, 'unpaid', 0, 0
    FROM employees e WHERE e.is_active = true
   ON CONFLICT (employee_id, year, leave_type) DO NOTHING;

  INSERT INTO leave_balances (employee_id, year, leave_type, entitled_days, remaining_days)
  SELECT e.id, current_year, 'emergency', 0, 0
    FROM employees e WHERE e.is_active = true
   ON CONFLICT (employee_id, year, leave_type) DO NOTHING;
END $$;
