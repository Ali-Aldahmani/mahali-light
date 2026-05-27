-- Phase 19: App settings + performance indexes.

CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name VARCHAR(200) DEFAULT 'My Store',
  store_name_ar VARCHAR(200),
  store_address TEXT,
  store_phone VARCHAR(20),
  store_email VARCHAR(100),
  store_trn VARCHAR(50),
  store_logo_path VARCHAR(500),
  store_currency VARCHAR(10) DEFAULT 'AED',
  store_timezone VARCHAR(50) DEFAULT 'Asia/Dubai',
  vat_enabled BOOLEAN DEFAULT true,
  vat_rate DECIMAL(5,2) DEFAULT 5.00,
  vat_number VARCHAR(50),
  invoice_prefix VARCHAR(10) DEFAULT 'INV',
  invoice_footer_note TEXT,
  invoice_terms TEXT,
  invoice_auto_print BOOLEAN DEFAULT false,
  invoice_draft_expiry_hours INT DEFAULT 24,
  pos_require_customer BOOLEAN DEFAULT false,
  pos_allow_negative_stock BOOLEAN DEFAULT false,
  pos_default_payment_method VARCHAR(20) DEFAULT 'cash',
  low_stock_threshold_default INT DEFAULT 10,
  dead_stock_days INT DEFAULT 30,
  reorder_safety_buffer_days INT DEFAULT 7,
  work_week_start INT DEFAULT 0,
  weekend_days JSONB DEFAULT '[5, 6]'::jsonb,
  fiscal_year_start_month INT DEFAULT 1,
  sidebar_collapsed BOOLEAN DEFAULT false,
  language VARCHAR(10) DEFAULT 'en',
  setup_completed BOOLEAN DEFAULT false,
  setup_completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (id)
  SELECT gen_random_uuid()
   WHERE NOT EXISTS (SELECT 1 FROM app_settings);

-- Performance indexes (IF NOT EXISTS — skip duplicates from earlier migrations).
CREATE INDEX IF NOT EXISTS idx_invoices_date_desc
  ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_confirmed_at_desc
  ON invoices(confirmed_at DESC)
  WHERE confirmed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_customer_status
  ON invoices(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_employee_date
  ON invoices(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_items_product_date
  ON invoice_items(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_items_variant_date
  ON invoice_items(variant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_movements_product_date
  ON stock_movements(product_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_movements_type_date
  ON stock_movements(movement_type, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_activity_timestamp_desc
  ON activity_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_type_entity_ts
  ON activity_log(entity_type, entity_id, timestamp DESC);

-- journal_lines.account_id index exists from 013_finance.sql

CREATE INDEX IF NOT EXISTS idx_notifications_created_desc
  ON notifications(created_at DESC)
  WHERE is_broadcast = false;
