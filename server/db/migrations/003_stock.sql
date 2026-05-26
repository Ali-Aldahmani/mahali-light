-- Phase 3: Inventory & Stock Management.
-- The suppliers FK on reorder_alerts is added later when Phase 4 migrates
-- the suppliers table; we keep the column nullable as plain UUID for now.

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  movement_type VARCHAR(50) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  qty_before DECIMAL(12,2) NOT NULL,
  qty_after DECIMAL(12,2) NOT NULL,
  reference_type VARCHAR(50),
  reference_id UUID,
  unit_label VARCHAR(20),
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS stock_adjustment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  adjustment_type VARCHAR(20) NOT NULL,
  current_qty DECIMAL(12,2) NOT NULL,
  requested_qty DECIMAL(12,2) NOT NULL,
  difference DECIMAL(12,2) NOT NULL,
  reason VARCHAR(50) NOT NULL,
  request_note TEXT NOT NULL,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  applied_movement_id UUID REFERENCES stock_movements(id)
);

CREATE TABLE IF NOT EXISTS stock_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  count_type VARCHAR(20) NOT NULL,
  category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  status VARCHAR(30) DEFAULT 'draft',
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  rejection_reason TEXT,
  total_products INT DEFAULT 0,
  matched_count INT DEFAULT 0,
  discrepancy_count INT DEFAULT 0,
  net_value_impact DECIMAL(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id UUID REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  system_qty DECIMAL(12,2) NOT NULL,
  counted_qty DECIMAL(12,2),
  difference DECIMAL(12,2),
  cost_price DECIMAL(12,2),
  value_impact DECIMAL(12,2),
  notes TEXT,
  counted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  counted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reorder_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  current_stock DECIMAL(12,2) NOT NULL,
  reorder_point DECIMAL(12,2) NOT NULL,
  recommended_order_qty DECIMAL(12,2) NOT NULL,
  suggested_supplier_id UUID,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_variant ON stock_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_movements_type ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_movements_timestamp ON stock_movements(timestamp);
CREATE INDEX IF NOT EXISTS idx_movements_reference ON stock_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_adj_requests_status ON stock_adjustment_requests(status);
CREATE INDEX IF NOT EXISTS idx_adj_requests_product ON stock_adjustment_requests(product_id);
CREATE INDEX IF NOT EXISTS idx_count_status ON stock_counts(status);
CREATE INDEX IF NOT EXISTS idx_reorder_status ON reorder_alerts(status);

-- Only one pending reorder alert per variant at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reorder_pending_variant
  ON reorder_alerts(variant_id)
  WHERE status = 'pending';
