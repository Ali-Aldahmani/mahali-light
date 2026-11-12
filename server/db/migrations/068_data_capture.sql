-- Migration 068: record what can't be rebuilt later (data readiness, 2026-11-12).
--
-- 1. lost_sales             a sale that couldn't happen because stock ran out
-- 2. variant_price_history  every selling price a variant has had, and since when
-- 3. invoice_line_changes   every change to a confirmed sale's lines, dated
-- 4. purchase_order_receipt_lines.expiry_date
-- 5. promotions / promotion_items
-- 6. store_calendar_events (closed days, Ramadan, Eid, holidays) and
--    store_opening_hours (dated, so past hours stay known)
--
-- Who made a change: services set app.user_id for the transaction
-- (withTransaction actorId); triggers read it.

-- 1. Lost sales ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lost_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
  available_qty DECIMAL(12,2),
  source VARCHAR(30) NOT NULL CHECK (source IN ('sale_refused', 'till_out_of_stock', 'manual')),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  -- Repeated taps or retries of the same sale count once; how often it happened is kept.
  occurrences INT NOT NULL DEFAULT 1,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS idx_lost_sales_variant ON lost_sales (variant_id, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lost_sales_invoice_variant
  ON lost_sales (invoice_id, variant_id) WHERE invoice_id IS NOT NULL;

-- 2. Selling price history ------------------------------------------------------
CREATE TABLE IF NOT EXISTS variant_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  selling_price DECIMAL(12,2) NOT NULL,
  previous_price DECIMAL(12,2),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 'backfilled': the price when history started; earlier changes were never recorded.
  source VARCHAR(20) NOT NULL DEFAULT 'change' CHECK (source IN ('created', 'change', 'backfilled'))
);
CREATE INDEX IF NOT EXISTS idx_variant_price_history ON variant_price_history (variant_id, effective_from DESC);

INSERT INTO variant_price_history (variant_id, selling_price, effective_from, source)
SELECT v.id, v.selling_price, COALESCE(v.created_at, NOW()), 'backfilled'
  FROM product_variants v
 WHERE v.selling_price IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM variant_price_history h WHERE h.variant_id = v.id);

CREATE OR REPLACE FUNCTION app_actor() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.user_id', true), '')::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION variant_price_track() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.selling_price IS NOT NULL THEN
      INSERT INTO variant_price_history (variant_id, selling_price, changed_by, source)
      VALUES (NEW.id, NEW.selling_price, app_actor(), 'created');
    END IF;
  ELSIF NEW.selling_price IS DISTINCT FROM OLD.selling_price AND NEW.selling_price IS NOT NULL THEN
    INSERT INTO variant_price_history (variant_id, selling_price, previous_price, changed_by, source)
    VALUES (NEW.id, NEW.selling_price, OLD.selling_price, app_actor(), 'change');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_variant_price_track ON product_variants;
CREATE TRIGGER trg_variant_price_track AFTER INSERT OR UPDATE OF selling_price ON product_variants
  FOR EACH ROW EXECUTE FUNCTION variant_price_track();

-- 3. Changes to confirmed sales -----------------------------------------------
-- Lines of a confirmed invoice only change through an approved edit; each
-- change is kept with its time, so the sale keeps its original moment and
-- the correction its own.
CREATE TABLE IF NOT EXISTS invoice_line_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_item_id UUID,
  variant_id UUID,
  change VARCHAR(10) NOT NULL CHECK (change IN ('added', 'changed', 'removed')),
  old_quantity DECIMAL(12,2),
  new_quantity DECIMAL(12,2),
  old_unit_price DECIMAL(12,2),
  new_unit_price DECIMAL(12,2),
  old_line_total DECIMAL(12,2),
  new_line_total DECIMAL(12,2),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  edit_request_id UUID
);
CREATE INDEX IF NOT EXISTS idx_invoice_line_changes ON invoice_line_changes (invoice_id, changed_at);

CREATE OR REPLACE FUNCTION invoice_line_track() RETURNS trigger AS $$
DECLARE
  inv_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  confirmed boolean;
  req_id uuid;
BEGIN
  SELECT status = 'confirmed' INTO confirmed FROM invoices WHERE id = inv_id;
  IF NOT COALESCE(confirmed, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  BEGIN
    req_id := NULLIF(current_setting('app.edit_request_id', true), '')::uuid;
  EXCEPTION WHEN others THEN req_id := NULL;
  END;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO invoice_line_changes (invoice_id, invoice_item_id, variant_id, change, new_quantity, new_unit_price, new_line_total, changed_by, edit_request_id)
    VALUES (inv_id, NEW.id, NEW.variant_id, 'added', NEW.quantity, NEW.unit_price, NEW.line_total, app_actor(), req_id);
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO invoice_line_changes (invoice_id, invoice_item_id, variant_id, change, old_quantity, old_unit_price, old_line_total, changed_by, edit_request_id)
    VALUES (inv_id, OLD.id, OLD.variant_id, 'removed', OLD.quantity, OLD.unit_price, OLD.line_total, app_actor(), req_id);
  ELSIF (NEW.quantity, NEW.unit_price, NEW.discount_amount, NEW.line_total)
        IS DISTINCT FROM (OLD.quantity, OLD.unit_price, OLD.discount_amount, OLD.line_total) THEN
    INSERT INTO invoice_line_changes (invoice_id, invoice_item_id, variant_id, change, old_quantity, new_quantity,
                                      old_unit_price, new_unit_price, old_line_total, new_line_total, changed_by, edit_request_id)
    VALUES (inv_id, NEW.id, NEW.variant_id, 'changed', OLD.quantity, NEW.quantity, OLD.unit_price, NEW.unit_price,
            OLD.line_total, NEW.line_total, app_actor(), req_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_invoice_line_track ON invoice_items;
CREATE TRIGGER trg_invoice_line_track
  AFTER INSERT OR DELETE OR UPDATE OF quantity, unit_price, discount_amount, line_total ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_line_track();

-- 4. Expiry dates on deliveries -------------------------------------------------
ALTER TABLE purchase_order_receipt_lines ADD COLUMN IF NOT EXISTS expiry_date DATE;
CREATE INDEX IF NOT EXISTS idx_po_receipt_lines_expiry ON purchase_order_receipt_lines (expiry_date) WHERE expiry_date IS NOT NULL;

-- 5. Promotions -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  discount_percent DECIMAL(5,2) CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100)),
  notes VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_early_at TIMESTAMPTZ,
  CONSTRAINT chk_promotion_dates CHECK (ends_on >= starts_on)
);
CREATE TABLE IF NOT EXISTS promotion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES product_categories(id) ON DELETE CASCADE,
  CONSTRAINT chk_promotion_item_one_target CHECK (num_nonnulls(product_id, variant_id, category_id) = 1)
);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions (starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_promotion_items_promotion ON promotion_items (promotion_id);

-- 6. Store calendar ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('closed', 'ramadan', 'eid', 'public_holiday', 'special')),
  name VARCHAR(150) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  -- Moon-sighted dates are estimates until announced; correct them then.
  estimated BOOLEAN NOT NULL DEFAULT false,
  notes VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_calendar_dates CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_store_calendar_dates ON store_calendar_events (starts_on, ends_on);
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_calendar_event ON store_calendar_events (kind, name, starts_on);

-- Estimated Ramadan and Eid dates (UAE), to be confirmed when announced.
INSERT INTO store_calendar_events (kind, name, starts_on, ends_on, estimated, notes) VALUES
  ('ramadan', 'Ramadan 2026', '2026-02-18', '2026-03-19', true, 'Estimated; confirm when announced'),
  ('eid', 'Eid al-Fitr 2026', '2026-03-20', '2026-03-22', true, 'Estimated; confirm when announced'),
  ('eid', 'Eid al-Adha 2026', '2026-05-26', '2026-05-29', true, 'Estimated; confirm when announced'),
  ('ramadan', 'Ramadan 2027', '2027-02-08', '2027-03-09', true, 'Estimated; confirm when announced'),
  ('eid', 'Eid al-Fitr 2027', '2027-03-10', '2027-03-12', true, 'Estimated; confirm when announced'),
  ('eid', 'Eid al-Adha 2027', '2027-05-16', '2027-05-19', true, 'Estimated; confirm when announced'),
  ('ramadan', 'Ramadan 2028', '2028-01-28', '2028-02-26', true, 'Estimated; confirm when announced'),
  ('eid', 'Eid al-Fitr 2028', '2028-02-27', '2028-02-29', true, 'Estimated; confirm when announced'),
  ('eid', 'Eid al-Adha 2028', '2028-05-04', '2028-05-07', true, 'Estimated; confirm when announced')
ON CONFLICT DO NOTHING;

-- Opening hours, kept as dated versions: the hours in force on any day are
-- the latest version that started on or before it. hours is
-- {"1": {"open": "09:00", "close": "22:00"}, ..., "7": null} (ISO weekday; null = closed).
CREATE TABLE IF NOT EXISTS store_opening_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from DATE NOT NULL,
  hours JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_opening_hours ON store_opening_hours (effective_from DESC, created_at DESC);
