-- Migration 027: reorder_recommendations dismissal.
--
-- POST /api/forecast/reorder/:id/dismiss only ever wrote an activity-log row —
-- the table had no column to actually record a dismissal, so a "dismissed"
-- recommendation reappeared immediately on the next list call. Add the
-- column and have listReorderRecommendations() filter it out; a recalculation
-- (manual or the monthly cron) clears it since the numbers backing the
-- recommendation have changed.

ALTER TABLE reorder_recommendations
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL;
