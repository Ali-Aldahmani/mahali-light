-- Payroll with accrual accounting.
--
-- A payroll run is calculated for a month from each employee's pay settings
-- and attendance. Approving it accrues the month's salaries in that month:
--   DR 5002 Salaries & Wages              gross earnings
--   DR 5018 Employer Payroll Contributions employer contributions
--   CR 2004 Salaries Payable              net pay owed to employees
--   CR 1006 Employee Advances             advances recovered from pay
--   CR 2005 Payroll Deductions Payable    other deductions + contributions owed
-- Paying it clears the liability (DR 2004 / CR cash or bank) and never touches
-- profit again. An advance is a receivable (DR 1006 / CR cash or bank), not an
-- expense, recovered through later runs. Voiding an unpaid approved run
-- reverses its accrual with a dated reversal; nothing is rewritten.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_allowance DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employer_contribution_rate DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS overtime_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.5;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employee_pay;
ALTER TABLE employees ADD CONSTRAINT chk_employee_pay CHECK (
  COALESCE(base_salary, 0) >= 0 AND monthly_allowance >= 0
  AND employer_contribution_rate >= 0 AND employer_contribution_rate <= 100
  AND overtime_multiplier >= 0 AND overtime_multiplier <= 5
);

INSERT INTO chart_of_accounts (code, name, type, is_system, description) VALUES
  ('1006', 'Employee Advances', 'asset', true, 'Salary advances and loans to employees, recovered through payroll.'),
  ('2004', 'Salaries Payable', 'liability', true, 'Net pay accrued by payroll and not yet paid.'),
  ('2005', 'Payroll Deductions Payable', 'liability', true, 'Amounts withheld from pay and employer contributions owed to third parties.'),
  ('5018', 'Employer Payroll Contributions', 'expense', true, 'Employer pension and other contributions on payroll.')
ON CONFLICT (code) DO NOTHING;
UPDATE chart_of_accounts c SET parent_id = p.id
  FROM chart_of_accounts p
 WHERE c.parent_id IS NULL AND c.code IN ('1006', '2004', '2005', '5018')
   AND p.code = CASE LEFT(c.code, 1) WHEN '1' THEN '1000' WHEN '2' THEN '2000' ELSE '5000' END;

CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number VARCHAR(30) NOT NULL UNIQUE,
  period_year INT NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'partially_paid', 'paid', 'voided')),
  gross_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  deductions_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  employer_contributions_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  paid_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  accrual_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  reversal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One live run per month.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_run_month ON payroll_runs (period_year, period_month)
  WHERE status <> 'voided';

CREATE TABLE IF NOT EXISTS payroll_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  employee_name VARCHAR(200) NOT NULL,
  salary_type VARCHAR(20) NOT NULL,
  base_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
  days_worked DECIMAL(6,2) NOT NULL DEFAULT 0,
  hours_worked DECIMAL(8,2) NOT NULL DEFAULT 0,
  overtime_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
  absent_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  unpaid_leave_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  base_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
  allowances DECIMAL(12,2) NOT NULL DEFAULT 0,
  overtime_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
  absence_deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
  gross_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
  advance_recovery DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
  employer_contribution DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  CONSTRAINT chk_payroll_line_amounts CHECK (
    gross_pay >= 0 AND net_pay >= 0 AND advance_recovery >= 0 AND other_deductions >= 0
    AND employer_contribution >= 0 AND paid_amount >= 0 AND paid_amount <= net_pay
    AND net_pay = gross_pay - advance_recovery - other_deductions
  ),
  CONSTRAINT uq_payroll_line_employee UNIQUE (run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS payroll_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  line_id UUID NOT NULL REFERENCES payroll_lines(id) ON DELETE RESTRICT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  method VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'bank')),
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  paid_date DATE NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  paid_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_run ON payroll_payments(run_id);

CREATE TABLE IF NOT EXISTS employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  recovered_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  issued_date DATE NOT NULL,
  method VARCHAR(20) NOT NULL CHECK (method IN ('cash', 'bank')),
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_advance_recovered CHECK (recovered_amount >= 0 AND recovered_amount <= amount)
);
CREATE INDEX IF NOT EXISTS idx_employee_advances_employee ON employee_advances(employee_id, issued_date);

-- Which advances each approved payroll line recovered, so a void puts them back.
CREATE TABLE IF NOT EXISTS payroll_advance_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id UUID NOT NULL REFERENCES payroll_lines(id) ON DELETE CASCADE,
  advance_id UUID NOT NULL REFERENCES employee_advances(id) ON DELETE RESTRICT,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0)
);

INSERT INTO permissions (key, label, module) VALUES
  ('payroll.view', 'View Payroll and Salaries', 'payroll'),
  ('payroll.manage', 'Set Salaries and Prepare Payroll', 'payroll'),
  ('payroll.approve', 'Approve and Void Payroll', 'payroll'),
  ('payroll.pay', 'Pay Salaries and Advances', 'payroll')
ON CONFLICT (key) DO NOTHING;
