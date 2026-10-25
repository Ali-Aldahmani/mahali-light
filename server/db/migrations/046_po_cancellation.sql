-- Migration 046: cancelling a purchase order keeps it (PO audit F04).
--
-- "Cancel PO" used to delete a draft outright — header, items and
-- attachment — while the activity log called it a cancellation, and a
-- confirmed PO could not be cancelled at all. A cancellation now sets
-- status 'cancelled' and records who, when and why; the PO, its items and
-- its attachment stay as evidence. Reports and summaries already skip
-- cancelled POs.
--
-- Additive only.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
