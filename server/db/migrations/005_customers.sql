-- Phase 5: Customer Management.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(100),
  address TEXT,
  company_name VARCHAR(200),
  trn_number VARCHAR(50),
  credit_balance DECIMAL(12,2) DEFAULT 0,
  credit_limit DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_id UUID, -- references invoices (Phase 6)
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  bank_account_id UUID, -- references bank_accounts (Phase 10)
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- Partial index speeds up the outstanding receivables query.
CREATE INDEX IF NOT EXISTS idx_customers_credit
  ON customers(credit_balance) WHERE credit_balance > 0;

-- Trigram index for fast fuzzy name search in POS.
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (name gin_trgm_ops);

-- Company also benefits from trigram lookups for B2B searches.
CREATE INDEX IF NOT EXISTS idx_customers_company_trgm
  ON customers USING gin (company_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer
  ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_invoice
  ON customer_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_date
  ON customer_payments(payment_date);
