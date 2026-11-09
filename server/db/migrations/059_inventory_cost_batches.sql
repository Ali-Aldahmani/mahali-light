-- Inventory cost batches (cost groups).
--
-- Stock is tracked per variant and per unit cost. Receiving goods at a cost a
-- variant already has adds to that group; a new cost opens a new group. Each
-- receipt keeps its own row (supplier, document, date, cost) even when its
-- quantity is merged into a group.
--
-- Invariants, kept by stockService.applyStockMovement (every stock change goes
-- through it, under the variant's row lock):
--   SUM(qty_on_hand)     = product_variants.stock_qty
--   SUM(qty_quarantined) = product_variants.quarantine_qty
--
-- The accounting cost policy does not change: journal COGS, stock value and
-- product_variants.cost_price stay on the latest purchase cost. A batch is a
-- physical group with its own recorded cost, used for profitability analysis.

CREATE SEQUENCE IF NOT EXISTS inventory_batch_number_seq;

CREATE TABLE IF NOT EXISTS inventory_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number VARCHAR(20) NOT NULL UNIQUE
    DEFAULT ('B-' || lpad(nextval('inventory_batch_number_seq')::text, 6, '0')),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  unit_cost DECIMAL(12,2) NOT NULL CHECK (unit_cost >= 0),
  qty_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  qty_quarantined DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (qty_quarantined >= 0),
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_batch_cost UNIQUE (variant_id, unit_cost)
);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_variant ON inventory_batches(variant_id, first_received_at, id);

-- Every receipt into a batch, kept separately.
CREATE TABLE IF NOT EXISTS inventory_batch_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE CASCADE,
  stock_movement_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL,
  source_type VARCHAR(50) NOT NULL,
  source_id UUID,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
  unit_cost DECIMAL(12,2) NOT NULL CHECK (unit_cost >= 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  employee_id UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_batch_receipts_batch ON inventory_batch_receipts(batch_id, received_at);
CREATE INDEX IF NOT EXISTS idx_batch_receipts_source ON inventory_batch_receipts(source_type, source_id);

-- Every change to a batch, one row per batch per stock movement.
CREATE TABLE IF NOT EXISTS inventory_batch_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE CASCADE,
  stock_movement_id UUID REFERENCES stock_movements(id) ON DELETE CASCADE,
  on_hand_change DECIMAL(12,2) NOT NULL DEFAULT 0,
  quarantine_change DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_batch_movements_batch ON inventory_batch_movements(batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_batch_movements_movement ON inventory_batch_movements(stock_movement_id);

-- Which batches each sold unit came from, at the batch's cost. returned_qty
-- counts units that later went back into the same batch (return, cancel,
-- edit), so a line is never restored twice.
CREATE TABLE IF NOT EXISTS inventory_batch_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  stock_movement_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL,
  invoice_item_id UUID REFERENCES invoice_items(id) ON DELETE SET NULL,
  quantity DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
  unit_cost DECIMAL(12,2) NOT NULL CHECK (unit_cost >= 0),
  returned_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_allocation_returned CHECK (returned_qty >= 0 AND returned_qty <= quantity)
);
CREATE INDEX IF NOT EXISTS idx_batch_allocations_item ON inventory_batch_allocations(invoice_item_id);
CREATE INDEX IF NOT EXISTS idx_batch_allocations_batch ON inventory_batch_allocations(batch_id);

-- The cashier's choice on a draft line: [{ "batchId": uuid, "quantity": n }].
-- NULL means "any": the oldest batches are used at confirm.
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS batch_selection JSONB;

-- Today's stock becomes one batch per variant at its current cost.
WITH opening AS (
  INSERT INTO inventory_batches (product_id, variant_id, unit_cost, qty_on_hand, qty_quarantined)
  SELECT v.product_id, v.id, v.cost_price, COALESCE(v.stock_qty, 0), COALESCE(v.quarantine_qty, 0)
    FROM product_variants v
   WHERE (COALESCE(v.stock_qty, 0) > 0 OR COALESCE(v.quarantine_qty, 0) > 0)
     AND NOT EXISTS (SELECT 1 FROM inventory_batches b WHERE b.variant_id = v.id)
  RETURNING id, unit_cost, qty_on_hand, qty_quarantined
)
INSERT INTO inventory_batch_receipts (batch_id, source_type, quantity, unit_cost)
SELECT id, 'opening_balance', qty_on_hand + qty_quarantined, unit_cost FROM opening;
