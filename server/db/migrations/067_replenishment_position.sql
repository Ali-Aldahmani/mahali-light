-- Migration 067: reorder advice that counts stock on order (purchase
-- decision audit 2026-11-12, P0). See services/replenishmentService.js.
--
-- reorder_recommendations keeps the forecast's own levels apart from the
-- advice, which is worked out again whenever it is read, from the stock on
-- hand and on order at that moment:
--   forecast_reorder_point  demand over lead time + safety days
--   forecast_order_up_to    that plus a month of demand
--   reorder_point, order_up_to, basis  the levels the advice used ('reorder_level'
--                           when staff set one on the item, else 'forecast')
--   on_hand, on_order, inventory_position, action, expected_stockout_date
--                           as at the last calculation
-- reorder_alerts records the stock on order and position it was raised at.

ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS forecast_reorder_point DECIMAL(12,2);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS forecast_order_up_to DECIMAL(12,2);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS order_up_to DECIMAL(12,2);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS basis VARCHAR(20);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS on_hand DECIMAL(12,2);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS on_order DECIMAL(12,2);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS inventory_position DECIMAL(12,2);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS action VARCHAR(10);
ALTER TABLE reorder_recommendations ADD COLUMN IF NOT EXISTS expected_stockout_date DATE;

ALTER TABLE reorder_alerts ADD COLUMN IF NOT EXISTS on_order DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE reorder_alerts ADD COLUMN IF NOT EXISTS inventory_position DECIMAL(12,2);
