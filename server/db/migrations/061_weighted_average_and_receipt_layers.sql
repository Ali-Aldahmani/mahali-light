-- Weighted average inventory valuation, and receipt-level stock (approved
-- 10 Nov 2026).
--
-- Accounting policy: perpetual weighted average cost (IAS 2). Each variant
-- carries its book value (inventory_value). A receipt adds what it cost; an
-- outgoing movement removes its quantity at the average (value / quantity),
-- or the whole remaining value when it empties the variant; goods coming
-- back from a sale or a supplier return re-enter at the value they left at.
-- cost_price becomes that average; last_purchase_cost keeps the latest
-- purchase price for display. Every stock movement records its value_change,
-- and every inventory journal line posts exactly that amount, so
-- SUM(inventory_value) = ledger account 1004 by construction.
--
-- Physical cost groups (migration 059) are unchanged and independent: which
-- batch a cashier picks never changes the accounting cost.
--
-- Receipt layers: within a cost group each receipt keeps its own original,
-- remaining, sold, returned and other-out quantities. Units leave a group
-- from its oldest receipt with stock first (FIFO by receipt date, then id);
-- goods coming back from a sale return to the receipt they left.

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS inventory_value DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS last_purchase_cost DECIMAL(12,2);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS value_change DECIMAL(14,2);

-- The cost of goods sold a line removed from the books, and how much of it
-- later came back through returns. NULL on lines from before this migration.
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cogs_value DECIMAL(14,2);
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cogs_returned DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE inventory_batch_receipts ADD COLUMN IF NOT EXISTS qty_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE inventory_batch_receipts ADD COLUMN IF NOT EXISTS qty_quarantined DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE inventory_batch_receipts ADD COLUMN IF NOT EXISTS qty_sold DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE inventory_batch_receipts ADD COLUMN IF NOT EXISTS qty_returned DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE inventory_batch_receipts ADD COLUMN IF NOT EXISTS qty_out_other DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE inventory_batch_receipts DROP CONSTRAINT IF EXISTS chk_receipt_quantities;
ALTER TABLE inventory_batch_receipts ADD CONSTRAINT chk_receipt_quantities CHECK (
  qty_on_hand >= 0 AND qty_quarantined >= 0 AND qty_sold >= 0 AND qty_returned >= 0 AND qty_out_other >= 0
);
CREATE INDEX IF NOT EXISTS idx_batch_receipts_fifo ON inventory_batch_receipts(batch_id, received_at, id);

ALTER TABLE inventory_batch_movements ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES inventory_batch_receipts(id) ON DELETE SET NULL;
ALTER TABLE inventory_batch_allocations ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES inventory_batch_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_batch_allocations_receipt ON inventory_batch_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_time ON stock_movements(variant_id, timestamp);

-- One-time correction of the gap between ledger 1004 and the book value,
-- booked against retained earnings when the policy starts (server start).
CREATE TABLE IF NOT EXISTS inventory_valuation_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(40) NOT NULL UNIQUE,
  ledger_before DECIMAL(14,2) NOT NULL,
  book_value DECIMAL(14,2) NOT NULL,
  difference DECIMAL(14,2) NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Book value of today's stock: what its cost groups were bought at, or the
-- current cost where a variant has stock but no groups yet.
UPDATE product_variants v
   SET inventory_value = COALESCE(b.value, ROUND((COALESCE(v.stock_qty, 0) + COALESCE(v.quarantine_qty, 0)) * v.cost_price, 2)),
       last_purchase_cost = COALESCE(
         (SELECT h.cost_price FROM product_cost_history h WHERE h.variant_id = v.id
           ORDER BY h.date DESC, h.created_at DESC LIMIT 1),
         v.cost_price)
  FROM (SELECT v2.id,
               (SELECT ROUND(SUM((b.qty_on_hand + b.qty_quarantined) * b.unit_cost), 2)
                  FROM inventory_batches b WHERE b.variant_id = v2.id) AS value
          FROM product_variants v2) b
 WHERE b.id = v.id;

UPDATE product_variants
   SET cost_price = ROUND(inventory_value / (stock_qty + quarantine_qty), 2)
 WHERE COALESCE(stock_qty, 0) + COALESCE(quarantine_qty, 0) > 0;

-- Spread each cost group's stock over its receipts, newest first (what is
-- left after selling the oldest first), and record the rest as gone out.
WITH ordered AS (
  SELECT r.id, r.quantity, b.qty_on_hand AS group_on_hand, b.qty_quarantined AS group_held,
         COALESCE(SUM(r.quantity) OVER (PARTITION BY r.batch_id ORDER BY r.received_at DESC, r.id DESC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS newer
    FROM inventory_batch_receipts r
    JOIN inventory_batches b ON b.id = r.batch_id
), placed AS (
  SELECT id, quantity,
         GREATEST(0, LEAST(quantity, group_on_hand + group_held - newer)) AS remaining,
         GREATEST(0, LEAST(quantity, group_held - newer)) AS held
    FROM ordered
)
UPDATE inventory_batch_receipts r
   SET qty_quarantined = p.held,
       qty_on_hand = p.remaining - p.held,
       qty_out_other = r.quantity - p.remaining
  FROM placed p
 WHERE p.id = r.id;

-- A group holding more than its receipts (stock healed into it) gets a
-- receipt for the difference, so receipts always add up to the group.
INSERT INTO inventory_batch_receipts (batch_id, source_type, quantity, unit_cost, qty_on_hand, qty_quarantined)
SELECT b.id, 'opening_balance',
       (b.qty_on_hand + b.qty_quarantined) - COALESCE(r.on_hand, 0) - COALESCE(r.held, 0),
       b.unit_cost,
       b.qty_on_hand - COALESCE(r.on_hand, 0),
       b.qty_quarantined - COALESCE(r.held, 0)
  FROM inventory_batches b
  LEFT JOIN (SELECT batch_id, SUM(qty_on_hand) AS on_hand, SUM(qty_quarantined) AS held
               FROM inventory_batch_receipts GROUP BY batch_id) r ON r.batch_id = b.id
 WHERE b.qty_on_hand - COALESCE(r.on_hand, 0) >= 0
   AND b.qty_quarantined - COALESCE(r.held, 0) >= 0
   AND (b.qty_on_hand + b.qty_quarantined) - COALESCE(r.on_hand, 0) - COALESCE(r.held, 0) > 0;
