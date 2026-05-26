-- Phase 6: POS & Invoices.

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  status VARCHAR(20) DEFAULT 'draft',
  -- draft / confirmed / cancelled / refunded
  subtotal DECIMAL(12,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  invoice_discount DECIMAL(12,2) DEFAULT 0,
  taxable_amount DECIMAL(12,2) DEFAULT 0,
  tax_rate DECIMAL(5,2) DEFAULT 5.00,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  total DECIMAL(12,2) DEFAULT 0,
  amount_paid DECIMAL(12,2) DEFAULT 0,
  balance_due DECIMAL(12,2) DEFAULT 0,
  payment_status VARCHAR(20) DEFAULT 'unpaid',
  -- unpaid / partial / paid
  has_return BOOLEAN DEFAULT false,
  pc_identifier VARCHAR(50),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_name VARCHAR(200) NOT NULL,
  variant_attributes JSONB,
  sku VARCHAR(100),
  unit_label VARCHAR(20) DEFAULT 'pcs',
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  cost_price_at_time DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  discount_amount DECIMAL(12,2) DEFAULT 0,
  line_subtotal DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  position INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL,
  -- cash / bank / credit
  amount DECIMAL(12,2) NOT NULL,
  bank_account_id UUID,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS invoice_edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  request_note TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  changes JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  old_snapshot JSONB,
  new_snapshot JSONB,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS offline_invoice_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_data JSONB NOT NULL,
  pc_identifier VARCHAR(50),
  client_uuid UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced BOOLEAN DEFAULT false,
  synced_at TIMESTAMPTZ,
  sync_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_pc ON invoices(pc_identifier);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_variant ON invoice_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_edit_requests_invoice
  ON invoice_edit_requests(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_edit_requests_status
  ON invoice_edit_requests(status);
CREATE INDEX IF NOT EXISTS idx_invoice_history_invoice
  ON invoice_history(invoice_id);

-- Allow per-PC sequences. Extends document_sequences with an optional scope
-- column so we can do INV-2026-P1-... independently from INV-2026-P2-...
ALTER TABLE document_sequences ADD COLUMN IF NOT EXISTS scope VARCHAR(50) NOT NULL DEFAULT '';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_sequences_pkey'
  ) THEN
    ALTER TABLE document_sequences DROP CONSTRAINT document_sequences_pkey;
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_sequences_pk_scoped'
  ) THEN
    ALTER TABLE document_sequences
      ADD CONSTRAINT document_sequences_pk_scoped PRIMARY KEY (doc_type, year, scope);
  END IF;
END$$;
