-- Phase 9: Returns, Refunds & Replacements.

CREATE TABLE IF NOT EXISTS return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(50) NOT NULL UNIQUE,
  -- RET-YYYY-XXXXX
  return_type VARCHAR(30) NOT NULL,
  -- customer_refund / customer_replace / supplier_return
  reference_type VARCHAR(20),
  -- invoice / purchase_order / manual
  reference_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  no_invoice_return BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(50) NOT NULL,
  -- defective / wrong_item / excess_stock / customer_request / expired / other
  request_note TEXT NOT NULL,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'pending',
  -- pending / approved / rejected / cancelled
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  executed_at TIMESTAMPTZ,
  executed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  -- Captured at submit time so manager can review the proposed refund mix
  -- + chosen replacement variants without recalculating from scratch.
  refund_plan JSONB,
  replacement_plan JSONB
);

CREATE TABLE IF NOT EXISTS return_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID REFERENCES return_requests(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL,
  product_name VARCHAR(200) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit_label VARCHAR(20),
  unit_price DECIMAL(12,2) NOT NULL,
  total_value DECIMAL(12,2) NOT NULL,
  condition VARCHAR(20) NOT NULL,
  -- good / defective / damaged
  serial_number VARCHAR(100),
  warranty_id UUID REFERENCES warranties(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS return_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_number VARCHAR(50) NOT NULL UNIQUE,
  -- RO-YYYY-XXXXX
  return_request_id UUID REFERENCES return_requests(id) ON DELETE SET NULL,
  return_type VARCHAR(30) NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  original_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  replacement_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  original_po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  total_value DECIMAL(12,2) DEFAULT 0,
  refund_total DECIMAL(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'completed',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS return_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id UUID REFERENCES return_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name VARCHAR(200) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit_label VARCHAR(20),
  unit_price DECIMAL(12,2) NOT NULL,
  total_value DECIMAL(12,2) NOT NULL,
  condition VARCHAR(20) NOT NULL,
  -- good / defective / damaged
  stock_action VARCHAR(20) NOT NULL,
  -- returned_to_stock / quarantined / disposed
  serial_number VARCHAR(100),
  warranty_id UUID REFERENCES warranties(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS refund_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_order_id UUID REFERENCES return_orders(id) ON DELETE CASCADE,
  method VARCHAR(20) NOT NULL,
  -- cash / bank / credit
  amount DECIMAL(12,2) NOT NULL,
  bank_account_id UUID,
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS return_request_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID REFERENCES return_requests(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  -- created / approved / rejected / cancelled / executed
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  old_status VARCHAR(20),
  new_status VARCHAR(20),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_return_requests_status
  ON return_requests(status);
CREATE INDEX IF NOT EXISTS idx_return_requests_type
  ON return_requests(return_type);
CREATE INDEX IF NOT EXISTS idx_return_requests_customer
  ON return_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_supplier
  ON return_requests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_reference
  ON return_requests(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_requested_by
  ON return_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_return_requests_requested_at
  ON return_requests(requested_at);

CREATE INDEX IF NOT EXISTS idx_return_request_items_request
  ON return_request_items(return_request_id);
CREATE INDEX IF NOT EXISTS idx_return_request_items_variant
  ON return_request_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_return_request_items_invoice_item
  ON return_request_items(invoice_item_id);

CREATE INDEX IF NOT EXISTS idx_return_orders_customer
  ON return_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_supplier
  ON return_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_invoice
  ON return_orders(original_invoice_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_po
  ON return_orders(original_po_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_created
  ON return_orders(created_at);

CREATE INDEX IF NOT EXISTS idx_return_order_items_order
  ON return_order_items(return_order_id);
CREATE INDEX IF NOT EXISTS idx_return_order_items_variant
  ON return_order_items(variant_id);

CREATE INDEX IF NOT EXISTS idx_refund_payments_order
  ON refund_payments(return_order_id);

CREATE INDEX IF NOT EXISTS idx_return_request_history_request
  ON return_request_history(return_request_id);
