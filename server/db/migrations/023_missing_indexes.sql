-- Migration 023: indexes for user_sessions idle-sweep and invoices aggregate.
--
-- Two query patterns were identified as performing full sequential scans:
--
--   1. socket/index.js idle-timeout sweeper fires every 60 s and evaluates:
--        WHERE logout_at IS NULL AND last_activity_at < NOW() - make_interval(...)
--      A partial index on the "still-open" subset eliminates the full scan.
--
--   2. invoicesController.list() runs a summary aggregate on the invoices table
--      on every first-page load:
--        WHERE status = 'confirmed' AND (created_at filters)
--      A composite index on (status, created_at) lets the planner use an
--      index scan for the FILTER clauses instead of scanning every row.
--
-- CONCURRENTLY is intentionally omitted — this migration runs inside the
-- migrate.js transaction wrapper at server startup before traffic is served,
-- so a non-concurrent build is safe and is the only form allowed inside an
-- explicit transaction block.

-- ── user_sessions ────────────────────────────────────────────────────────────

-- Partial index covering only open sessions (logout_at IS NULL).
-- Used by: socket idle-timeout sweeper, requireAuth idle check, dbCleanup job.
CREATE INDEX IF NOT EXISTS idx_user_sessions_open_activity
    ON user_sessions (last_activity_at)
    WHERE logout_at IS NULL;

-- ── invoices ─────────────────────────────────────────────────────────────────

-- Composite index for the status + date filters used by the list summary
-- aggregate and the overdue/draft job queries.
CREATE INDEX IF NOT EXISTS idx_invoices_status_created_at
    ON invoices (status, created_at DESC);
