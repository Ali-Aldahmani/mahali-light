-- Phase 10: Cash Drawer & Bank Accounts.

CREATE TABLE IF NOT EXISTS cash_drawer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) DEFAULT 'Main Cash Drawer',
  current_balance DECIMAL(12,2) DEFAULT 0,
  opening_balance DECIMAL(12,2) DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  last_closed_at TIMESTAMPTZ,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'closed',
  -- open / closed
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_drawer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_drawer_id UUID REFERENCES cash_drawer(id) ON DELETE CASCADE,
  opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  opening_balance DECIMAL(12,2) NOT NULL,
  closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  closing_balance DECIMAL(12,2),
  expected_balance DECIMAL(12,2),
  discrepancy DECIMAL(12,2),
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'open',
  -- open / closed
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_drawer_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_drawer_id UUID REFERENCES cash_drawer(id) ON DELETE CASCADE,
  session_id UUID REFERENCES cash_drawer_sessions(id) ON DELETE SET NULL,
  transaction_type VARCHAR(30) NOT NULL,
  -- sale / refund / supplier_payment / customer_payment /
  -- expense / manual_in / manual_out / opening / closing / transfer
  direction VARCHAR(10) NOT NULL,
  -- in / out
  amount DECIMAL(12,2) NOT NULL,
  balance_before DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  reference_type VARCHAR(30),
  reference_id UUID,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(200) NOT NULL,
  account_number VARCHAR(50),
  iban VARCHAR(50),
  currency VARCHAR(10) DEFAULT 'AED',
  current_balance DECIMAL(12,2) DEFAULT 0,
  opening_balance DECIMAL(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE CASCADE,
  transaction_type VARCHAR(30) NOT NULL,
  -- sale / refund / supplier_payment / customer_payment /
  -- expense / bill_payment / manual_deposit / manual_withdrawal / transfer
  direction VARCHAR(10) NOT NULL,
  -- in / out
  amount DECIMAL(12,2) NOT NULL,
  balance_before DECIMAL(12,2) NOT NULL,
  balance_after DECIMAL(12,2) NOT NULL,
  reference_type VARCHAR(30),
  reference_id UUID,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  description TEXT,
  receipt_attachment VARCHAR(500),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_type VARCHAR(20) NOT NULL,
  -- cash_drawer / bank_account
  from_id UUID NOT NULL,
  to_type VARCHAR(20) NOT NULL,
  -- cash_drawer / bank_account
  to_id UUID NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_transactions_drawer
  ON cash_drawer_transactions(cash_drawer_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_session
  ON cash_drawer_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_type
  ON cash_drawer_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_timestamp
  ON cash_drawer_transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_reference
  ON cash_drawer_transactions(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account
  ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_type
  ON bank_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date
  ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_reference
  ON bank_transactions(reference_type, reference_id);

-- Only ONE row may be flagged as default per active bank account. The partial
-- unique index lets us flip the flag freely while still preventing two
-- defaults from co-existing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_default
  ON bank_accounts ((is_default))
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_drawer
  ON cash_drawer_sessions(cash_drawer_id);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_opened_at
  ON cash_drawer_sessions(opened_at);
CREATE INDEX IF NOT EXISTS idx_cash_transfers_date
  ON cash_transfers(transfer_date);

-- Seed the single store-level cash drawer if one doesn't already exist.
INSERT INTO cash_drawer (name, status)
SELECT 'Main Cash Drawer', 'closed'
WHERE NOT EXISTS (SELECT 1 FROM cash_drawer);
