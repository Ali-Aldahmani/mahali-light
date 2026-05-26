-- Phase 13: Finance system (chart of accounts, journal, periods).

CREATE TABLE IF NOT EXISTS financial_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  period_type VARCHAR(20) NOT NULL,
  -- monthly / quarterly / yearly
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'open',
  -- open / closed
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_periods_status
  ON financial_periods(status);
CREATE INDEX IF NOT EXISTS idx_periods_dates
  ON financial_periods(start_date, end_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_periods_name_type
  ON financial_periods(name, period_type);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(20) NOT NULL,
  -- asset / liability / equity / revenue / expense
  parent_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number VARCHAR(50) NOT NULL UNIQUE,
  reference_type VARCHAR(50),
  reference_id UUID,
  period_id UUID REFERENCES financial_periods(id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  is_manual BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  debit DECIMAL(12,2) DEFAULT 0,
  credit DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  CONSTRAINT debit_or_credit CHECK (
    (debit > 0 AND credit = 0) OR
    (credit > 0 AND debit = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_reference
  ON journal_entries(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date
  ON journal_entries(date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_period
  ON journal_entries(period_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry
  ON journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account
  ON journal_lines(account_id);

-- Per-year sequence for entry numbers (JE-2026-00042).
CREATE TABLE IF NOT EXISTS journal_entry_sequence (
  year INT PRIMARY KEY,
  last_seq INT NOT NULL DEFAULT 0
);

-- Add VAT amount to purchase orders if not already there. Allows the VAT
-- report to pull input tax cleanly without retrofitting later.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS vat_amount DECIMAL(12,2) DEFAULT 0;

-- Seed chart of accounts.
INSERT INTO chart_of_accounts (code, name, type, is_system) VALUES
  ('1000', 'Assets',              'asset',     true),
  ('1001', 'Cash in Drawer',      'asset',     true),
  ('1002', 'Bank Accounts',       'asset',     true),
  ('1003', 'Accounts Receivable', 'asset',     true),
  ('1004', 'Inventory',           'asset',     true),
  ('1005', 'Prepaid Expenses',    'asset',     false),
  ('2000', 'Liabilities',         'liability', true),
  ('2001', 'Accounts Payable',    'liability', true),
  ('2002', 'VAT Payable',         'liability', true),
  ('2003', 'Customer Deposits',   'liability', false),
  ('3000', 'Equity',              'equity',    true),
  ('3001', 'Owner Equity',        'equity',    true),
  ('3002', 'Retained Earnings',   'equity',    true),
  ('4000', 'Revenue',             'revenue',   true),
  ('4001', 'Sales Revenue',       'revenue',   true),
  ('4002', 'Other Income',        'revenue',   false),
  ('5000', 'Expenses',            'expense',   true),
  ('5001', 'Cost of Goods Sold',  'expense',   true),
  ('5002', 'Salaries & Wages',    'expense',   true),
  ('5003', 'Electricity',         'expense',   false),
  ('5004', 'Water',               'expense',   false),
  ('5005', 'Rent',                'expense',   false),
  ('5006', 'Internet',            'expense',   false),
  ('5007', 'Trade License',       'expense',   false),
  ('5008', 'Government Fees',     'expense',   false),
  ('5009', 'Insurance',           'expense',   false),
  ('5010', 'Maintenance',         'expense',   false),
  ('5011', 'Marketing',           'expense',   false),
  ('5012', 'Transport',           'expense',   false),
  ('5013', 'Refunds Given',       'expense',   true),
  ('5014', 'Miscellaneous',       'expense',   false)
ON CONFLICT (code) DO NOTHING;

-- Set parent_id for sub-accounts based on top-level codes (1000/2000/3000/4000/5000).
UPDATE chart_of_accounts c
   SET parent_id = p.id
  FROM chart_of_accounts p
 WHERE p.code IN ('1000','2000','3000','4000','5000')
   AND c.code <> p.code
   AND substring(c.code, 1, 1) = substring(p.code, 1, 1)
   AND c.parent_id IS NULL;

-- Seed financial periods for 2026 (monthly + quarterly + half + yearly).
INSERT INTO financial_periods (name, period_type, start_date, end_date) VALUES
  ('January 2026',   'monthly',   '2026-01-01', '2026-01-31'),
  ('February 2026',  'monthly',   '2026-02-01', '2026-02-28'),
  ('March 2026',     'monthly',   '2026-03-01', '2026-03-31'),
  ('April 2026',     'monthly',   '2026-04-01', '2026-04-30'),
  ('May 2026',       'monthly',   '2026-05-01', '2026-05-31'),
  ('June 2026',      'monthly',   '2026-06-01', '2026-06-30'),
  ('July 2026',      'monthly',   '2026-07-01', '2026-07-31'),
  ('August 2026',    'monthly',   '2026-08-01', '2026-08-31'),
  ('September 2026', 'monthly',   '2026-09-01', '2026-09-30'),
  ('October 2026',   'monthly',   '2026-10-01', '2026-10-31'),
  ('November 2026',  'monthly',   '2026-11-01', '2026-11-30'),
  ('December 2026',  'monthly',   '2026-12-01', '2026-12-31'),
  ('Q1 2026',        'quarterly', '2026-01-01', '2026-03-31'),
  ('Q2 2026',        'quarterly', '2026-04-01', '2026-06-30'),
  ('Q3 2026',        'quarterly', '2026-07-01', '2026-09-30'),
  ('Q4 2026',        'quarterly', '2026-10-01', '2026-12-31'),
  ('H1 2026',        'yearly',    '2026-01-01', '2026-06-30'),
  ('H2 2026',        'yearly',    '2026-07-01', '2026-12-31'),
  ('FY 2026',        'yearly',    '2026-01-01', '2026-12-31')
ON CONFLICT (name, period_type) DO NOTHING;
