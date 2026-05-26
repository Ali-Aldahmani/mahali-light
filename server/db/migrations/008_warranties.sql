-- Phase 8: Warranty system.

CREATE TABLE IF NOT EXISTS warranties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_number VARCHAR(50) NOT NULL UNIQUE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  serial_number VARCHAR(100),
  warranty_type VARCHAR(20) NOT NULL DEFAULT 'customer',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  duration_months INT NOT NULL,
  terms TEXT,
  status VARCHAR(20) DEFAULT 'active',
  -- active / expired / claimed / void
  void_reason TEXT,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number VARCHAR(50) NOT NULL UNIQUE,
  warranty_id UUID REFERENCES warranties(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
  issue_description TEXT NOT NULL,
  resolution VARCHAR(20),
  -- replaced / repaired / rejected
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_date DATE,
  replacement_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  supplier_claim_raised BOOLEAN DEFAULT false,
  supplier_claim_resolved BOOLEAN DEFAULT false,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'open',
  -- open / in_progress / resolved / rejected
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warranties_customer ON warranties(customer_id);
CREATE INDEX IF NOT EXISTS idx_warranties_product ON warranties(product_id);
CREATE INDEX IF NOT EXISTS idx_warranties_invoice ON warranties(invoice_id);
CREATE INDEX IF NOT EXISTS idx_warranties_serial ON warranties(serial_number);
CREATE INDEX IF NOT EXISTS idx_warranties_status ON warranties(status);
CREATE INDEX IF NOT EXISTS idx_warranties_end_date ON warranties(end_date);
CREATE INDEX IF NOT EXISTS idx_warranties_invoice_item ON warranties(invoice_item_id);
CREATE INDEX IF NOT EXISTS idx_warranties_supplier ON warranties(supplier_id);
CREATE INDEX IF NOT EXISTS idx_warranties_type ON warranties(warranty_type);

CREATE INDEX IF NOT EXISTS idx_claims_warranty ON warranty_claims(warranty_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON warranty_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_customer ON warranty_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_claims_date ON warranty_claims(claim_date);

-- Add serial number support to invoice items.
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS serial_number VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_invoice_items_serial ON invoice_items(serial_number);

-- Helper view-free uniqueness guard: prevent two ACTIVE warranties with the
-- same serial for the same product. Phase 8 enforces this at the service
-- layer too, but a partial unique index is the safety net.
CREATE UNIQUE INDEX IF NOT EXISTS uq_warranties_active_serial_product
  ON warranties (product_id, serial_number)
  WHERE status = 'active' AND serial_number IS NOT NULL;
