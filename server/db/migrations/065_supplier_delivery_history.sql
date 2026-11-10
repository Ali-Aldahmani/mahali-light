-- Migration 065: delivery history a supplier ETA model can learn from
-- (supplier delivery ML readiness audit 2026-11-10, P0).
--
-- 1. purchase_order_receipts / _lines: one row per delivery, with when the
--    goods actually arrived (delivered_at, entered by the person receiving)
--    kept apart from when it was recorded (recorded_at, server time). Lines
--    point at the PO line, not just the variant.
-- 2. purchase_order_items.quantity_cancelled + short_closed_*: the part of an
--    order the supplier will never deliver can be closed, so an order has an
--    end and "never came" is recorded instead of left open forever.
-- 3. purchase_order_promises: every delivery date promised for an order,
--    store estimate or supplier promise, kept as history. The first supplier
--    promise is the original and never changes.
-- 4. supplier_lead_time_history: the supplier's default lead time as it was
--    at any moment, so old orders are judged by what was expected then.
--
-- Existing receipts are backfilled from stock movements (delivered_at =
-- recorded time, marked 'backfilled'); existing expected dates become the
-- first store estimate; current lead times start each supplier's history.

-- 1. Receipts ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  delivered_at TIMESTAMPTZ NOT NULL,
  delivered_at_source VARCHAR(20) NOT NULL DEFAULT 'entered'
    CHECK (delivered_at_source IN ('entered', 'defaulted', 'backfilled')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  delivery_note VARCHAR(200),
  CONSTRAINT chk_receipt_not_after_recording CHECK (delivered_at <= recorded_at + INTERVAL '5 minutes')
);
CREATE INDEX IF NOT EXISTS idx_po_receipts_po ON purchase_order_receipts (purchase_order_id, delivered_at);
CREATE INDEX IF NOT EXISTS idx_po_receipts_supplier ON purchase_order_receipts (supplier_id, delivered_at);

CREATE TABLE IF NOT EXISTS purchase_order_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id UUID REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_po_receipt_lines_receipt ON purchase_order_receipt_lines (receipt_id);
CREATE INDEX IF NOT EXISTS idx_po_receipt_lines_item ON purchase_order_receipt_lines (purchase_order_item_id);

-- Backfill: one receipt per PO per recorded moment.
INSERT INTO purchase_order_receipts (purchase_order_id, supplier_id, delivered_at, delivered_at_source, recorded_at, recorded_by)
SELECT sm.reference_id, po.supplier_id, MIN(sm.timestamp), 'backfilled', MIN(sm.timestamp), MIN(sm.employee_id::text)::uuid
  FROM stock_movements sm
  JOIN purchase_orders po ON po.id = sm.reference_id
 WHERE sm.reference_type = 'purchase_order' AND sm.movement_type = 'purchase'
   AND NOT EXISTS (SELECT 1 FROM purchase_order_receipts r WHERE r.purchase_order_id = sm.reference_id)
 GROUP BY sm.reference_id, po.supplier_id, date_trunc('second', sm.timestamp);

INSERT INTO purchase_order_receipt_lines (receipt_id, purchase_order_item_id, variant_id, quantity)
SELECT r.id,
       (SELECT i.id FROM purchase_order_items i
         WHERE i.purchase_order_id = sm.reference_id AND i.variant_id = sm.variant_id
         ORDER BY i.created_at LIMIT 1),
       sm.variant_id, sm.quantity
  FROM purchase_order_receipts r
  JOIN stock_movements sm
    ON sm.reference_id = r.purchase_order_id AND sm.reference_type = 'purchase_order'
   AND sm.movement_type = 'purchase' AND date_trunc('second', sm.timestamp) = date_trunc('second', r.delivered_at)
 WHERE r.delivered_at_source = 'backfilled' AND sm.quantity > 0
   AND NOT EXISTS (SELECT 1 FROM purchase_order_receipt_lines l WHERE l.receipt_id = r.id);

-- 2. Closing what will never come ---------------------------------------------
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS quantity_cancelled DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS short_closed_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS short_closed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS short_close_reason TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_po_item_cancelled_range') THEN
    ALTER TABLE purchase_order_items ADD CONSTRAINT chk_po_item_cancelled_range
      CHECK (quantity_cancelled >= 0 AND quantity_received + quantity_cancelled <= quantity + 0.000001);
  END IF;
END $$;

-- 3. Promises -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_promises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  promised_date DATE NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('store_estimate', 'supplier')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS idx_po_promises_po ON purchase_order_promises (purchase_order_id, recorded_at);

-- The first supplier promise and the latest one, kept on the order for reads.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS original_promised_date DATE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS promised_date DATE;

-- Promise history is append-only.
CREATE OR REPLACE FUNCTION po_promises_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'purchase_order_promises is append-only';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_po_promises_append_only ON purchase_order_promises;
CREATE TRIGGER trg_po_promises_append_only BEFORE UPDATE ON purchase_order_promises
  FOR EACH ROW EXECUTE FUNCTION po_promises_append_only();

-- Once set, the original supplier promise never changes.
CREATE OR REPLACE FUNCTION po_original_promise_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.original_promised_date IS NOT NULL
     AND NEW.original_promised_date IS DISTINCT FROM OLD.original_promised_date THEN
    RAISE EXCEPTION 'original_promised_date cannot change once set';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_po_original_promise_frozen ON purchase_orders;
CREATE TRIGGER trg_po_original_promise_frozen BEFORE UPDATE OF original_promised_date ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION po_original_promise_frozen();

-- Existing expected dates are the store's estimate at confirmation.
INSERT INTO purchase_order_promises (purchase_order_id, promised_date, source, recorded_at, recorded_by, note)
SELECT po.id, po.expected_date, 'store_estimate', COALESCE(po.confirmed_at, po.created_at), po.employee_id, 'Backfilled from the expected date'
  FROM purchase_orders po
 WHERE po.expected_date IS NOT NULL AND po.status <> 'draft'
   AND NOT EXISTS (SELECT 1 FROM purchase_order_promises p WHERE p.purchase_order_id = po.id);

-- 4. Lead-time history -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_lead_time_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  lead_time_days INT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_lead_time_history ON supplier_lead_time_history (supplier_id, effective_from DESC);

-- Each supplier's current value is its history from creation (the best that
-- is known; earlier edits were never recorded).
INSERT INTO supplier_lead_time_history (supplier_id, lead_time_days, effective_from, changed_by)
SELECT s.id, s.default_lead_time_days, s.created_at, s.created_by
  FROM suppliers s
 WHERE NOT EXISTS (SELECT 1 FROM supplier_lead_time_history h WHERE h.supplier_id = s.id);

-- Every later change is recorded by the database itself, whichever code path makes it.
CREATE OR REPLACE FUNCTION supplier_lead_time_track() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.default_lead_time_days IS DISTINCT FROM OLD.default_lead_time_days THEN
    INSERT INTO supplier_lead_time_history (supplier_id, lead_time_days, effective_from, changed_by)
    VALUES (NEW.id, NEW.default_lead_time_days, NOW(), NULLIF(current_setting('app.user_id', true), '')::uuid);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_supplier_lead_time_track ON suppliers;
CREATE TRIGGER trg_supplier_lead_time_track AFTER INSERT OR UPDATE OF default_lead_time_days ON suppliers
  FOR EACH ROW EXECUTE FUNCTION supplier_lead_time_track();
