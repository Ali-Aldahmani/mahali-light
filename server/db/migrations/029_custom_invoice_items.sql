-- Migration 029: custom (non-catalog, third-party) invoice line items.
--
-- Lets a cashier add a manual line to a normal invoice for a product that
-- isn't in the shop's own catalog (e.g. a third-party item they resell but
-- don't stock). product_id/variant_id were already nullable, so no
-- constraint change is needed there — this just adds the two columns that
-- distinguish a custom line and record who it's owed to.

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS third_party_name VARCHAR(200);

-- cost_price_at_time already exists and is reused for the third-party cost
-- (what's owed to them per unit) — every report/KPI that computes COGS from
-- SUM(quantity * cost_price_at_time) picks this up automatically with no
-- further change needed on the read side.
