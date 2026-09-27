-- Migration 034: allow several pricing restrictions on one product at once.
--
-- Still one row per product (UNIQUE product_id). Each value column is now an
-- independent rule: a non-NULL value means that restriction is enabled.
-- Legacy rows from 031 have exactly one value column set, so they remain
-- valid as a single enabled restriction. restriction_type only named which
-- column was set, so dropping it loses no information.

ALTER TABLE pricing_restrictions
  DROP CONSTRAINT IF EXISTS pricing_restrictions_mutually_exclusive;

ALTER TABLE pricing_restrictions
  DROP COLUMN IF EXISTS restriction_type;

-- A row with every rule disabled is meaningless; disabling all rules deletes
-- the row instead.
ALTER TABLE pricing_restrictions
  ADD CONSTRAINT pricing_restrictions_at_least_one CHECK (
    min_price IS NOT NULL
    OR max_discount_percent IS NOT NULL
    OR max_discount_amount IS NOT NULL
  );
