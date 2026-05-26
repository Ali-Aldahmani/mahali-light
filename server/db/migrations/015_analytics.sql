-- Phase 15: Analytics & Demand Forecasting.

CREATE TABLE IF NOT EXISTS sales_history_monthly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  -- 1-12
  units_sold DECIMAL(12,2) DEFAULT 0,
  revenue DECIMAL(12,2) DEFAULT 0,
  cost_total DECIMAL(12,2) DEFAULT 0,
  gross_profit DECIMAL(12,2) DEFAULT 0,
  return_qty DECIMAL(12,2) DEFAULT 0,
  invoice_count INT DEFAULT 0,
  avg_selling_price DECIMAL(12,2) DEFAULT 0,
  avg_cost_price DECIMAL(12,2) DEFAULT 0,
  UNIQUE(variant_id, year, month)
);

CREATE TABLE IF NOT EXISTS reorder_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  recommended_qty DECIMAL(12,2) NOT NULL,
  based_on_months INT DEFAULT 12,
  daily_avg_sales DECIMAL(12,4),
  lead_time_days INT,
  safety_buffer_days INT DEFAULT 7,
  reorder_point DECIMAL(12,2),
  peak_month INT,
  is_peak_season BOOLEAN DEFAULT false,
  peak_multiplier DECIMAL(4,2) DEFAULT 2.0,
  confidence VARCHAR(10) DEFAULT 'low',
  -- high / medium / low
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(variant_id)
);

CREATE TABLE IF NOT EXISTS annual_stock_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  recommended_qty DECIMAL(12,2) NOT NULL,
  estimated_cost DECIMAL(12,2),
  basis VARCHAR(20) DEFAULT 'historical',
  -- historical / manual / adjusted
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(variant_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_sales_history_variant
  ON sales_history_monthly(variant_id);
CREATE INDEX IF NOT EXISTS idx_sales_history_year_month
  ON sales_history_monthly(year, month);
CREATE INDEX IF NOT EXISTS idx_sales_history_product
  ON sales_history_monthly(product_id);
CREATE INDEX IF NOT EXISTS idx_reorder_product
  ON reorder_recommendations(product_id);
CREATE INDEX IF NOT EXISTS idx_annual_plan_variant
  ON annual_stock_plans(variant_id, year);
CREATE INDEX IF NOT EXISTS idx_annual_plan_product_year
  ON annual_stock_plans(product_id, year);
