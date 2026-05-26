-- Phase 4: Suppliers & Purchase Orders.

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(100),
  address TEXT,
  payment_terms VARCHAR(100),
  default_lead_time_days INT DEFAULT 3,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number VARCHAR(50) NOT NULL UNIQUE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  received_date DATE,
  status VARCHAR(30) DEFAULT 'draft',
  subtotal DECIMAL(12,2) DEFAULT 0,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  total_cost DECIMAL(12,2) DEFAULT 0,
  amount_paid DECIMAL(12,2) DEFAULT 0,
  balance_due DECIMAL(12,2) DEFAULT 0,
  payment_status VARCHAR(20) DEFAULT 'unpaid',
  due_date DATE,
  attachment_path VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity DECIMAL(12,2) NOT NULL,
  unit_label VARCHAR(20),
  cost_price_per_unit DECIMAL(12,2) NOT NULL,
  total_cost DECIMAL(12,2) NOT NULL,
  quantity_received DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(20) NOT NULL,
  bank_account_id UUID, -- populated when Phase 10 banks land
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  receipt_attachment VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_cost_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_price DECIMAL(12,2) NOT NULL,
  quantity_bought DECIMAL(12,2) NOT NULL,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number VARCHAR(50) NOT NULL UNIQUE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason VARCHAR(50) NOT NULL,
  status VARCHAR(30) DEFAULT 'pending',
  resolution VARCHAR(30),
  resolution_notes TEXT,
  total_value DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_return_id UUID REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL,
  total_value DECIMAL(12,2) NOT NULL,
  condition VARCHAR(20),
  serial_number VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_payment_status ON purchase_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_po_due_date ON purchase_orders(due_date);
CREATE INDEX IF NOT EXISTS idx_po_number ON purchase_orders(po_number);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product ON purchase_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_po ON supplier_payments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_cost_history_product ON product_cost_history(product_id);
CREATE INDEX IF NOT EXISTS idx_cost_history_variant ON product_cost_history(variant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_returns_supplier ON supplier_returns(supplier_id);

-- Backfill the FK from reorder_alerts.suggested_supplier_id now that
-- the suppliers table exists. Phase 3 created the column as a plain UUID.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reorder_alerts_suggested_supplier_id_fkey'
  ) THEN
    ALTER TABLE reorder_alerts
      ADD CONSTRAINT reorder_alerts_suggested_supplier_id_fkey
      FOREIGN KEY (suggested_supplier_id)
      REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
END$$;

-- Sequence per year for PO numbers. We use a table-based counter instead of
-- a Postgres sequence so we can reset per year cleanly.
CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type VARCHAR(50) NOT NULL,
  year INT NOT NULL,
  last_value INT NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);
