-- Phase 12: Bills & Expenses.

CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL,
  -- recurring / one_time
  icon VARCHAR(10),
  -- emoji icon
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  vendor_name VARCHAR(200),
  amount DECIMAL(12,2),
  is_variable_amount BOOLEAN DEFAULT false,
  frequency VARCHAR(20) NOT NULL,
  -- monthly / quarterly / yearly
  start_date DATE NOT NULL,
  next_due_date DATE NOT NULL,
  reminder_days_before INT DEFAULT 7,
  payment_method VARCHAR(20) DEFAULT 'bank',
  -- cash / bank
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  auto_recurring BOOLEAN DEFAULT true,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'active',
  -- active / paused / cancelled
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID REFERENCES bills(id) ON DELETE CASCADE,
  amount_due DECIMAL(12,2) NOT NULL,
  amount_paid DECIMAL(12,2),
  due_date DATE NOT NULL,
  paid_date DATE,
  payment_method VARCHAR(20),
  -- cash / bank
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  receipt_attachment VARCHAR(500),
  paid_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'upcoming',
  -- upcoming / due / overdue / paid
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS one_time_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  description VARCHAR(500) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(20) NOT NULL,
  -- cash / bank
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  receipt_attachment VARCHAR(500),
  paid_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bill_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_payment_id UUID REFERENCES bill_payments(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  -- upcoming / due_today / overdue
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_next_due ON bills(next_due_date);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_status ON bill_payments(status);
CREATE INDEX IF NOT EXISTS idx_bill_payments_due_date ON bill_payments(due_date);
CREATE INDEX IF NOT EXISTS idx_one_time_expenses_date ON one_time_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_one_time_expenses_category ON one_time_expenses(category_id);

-- Prevent the daily sweep from inserting the same reminder twice per
-- bill_payment+type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bill_notifications_active
  ON bill_notifications(bill_payment_id, type)
  WHERE is_resolved = false;

-- Seed expense categories (idempotent via ON CONFLICT).
INSERT INTO expense_categories (name, type, icon) VALUES
  ('Electricity',     'recurring', '⚡'),
  ('Water',           'recurring', '💧'),
  ('Internet',        'recurring', '🌐'),
  ('Rent',            'recurring', '🏠'),
  ('Trade License',   'recurring', '📋'),
  ('Government Fees', 'recurring', '🏛️'),
  ('Insurance',       'recurring', '🛡️'),
  ('Maintenance',     'one_time',  '🔧'),
  ('Office Supplies', 'one_time',  '📦'),
  ('Marketing',       'one_time',  '📢'),
  ('Transport',       'one_time',  '🚗'),
  ('Miscellaneous',   'one_time',  '📌')
ON CONFLICT (name) DO NOTHING;
