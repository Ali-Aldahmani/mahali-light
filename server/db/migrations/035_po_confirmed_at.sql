-- When a PO was actually confirmed (sent to the supplier).
--
-- order_date is the day the PO was *created*; a draft that sat for a week
-- made the supplier look a week slower. Lead-time calculations now start the
-- clock at confirmed_at and fall back to order_date for older POs.
--
-- Additive + nullable on purpose: existing POs keep NULL (we don't know their
-- real confirmation time, and guessing would poison delivery-time stats), and
-- an older app version keeps working against this schema if rolled back.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
