-- Migration 031: per-product pricing restrictions.
--
-- Exactly one restriction per product (UNIQUE product_id, upserted rather
-- than inserted fresh each time), and exactly one of the three value
-- columns populated, matching restriction_type — enforced here with a CHECK
-- constraint so a direct SQL/API bypass can never persist a mutually-
-- exclusive or mismatched row, not just app-level validation.

CREATE TABLE IF NOT EXISTS pricing_restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  restriction_type VARCHAR(30) NOT NULL
    CHECK (restriction_type IN ('MINIMUM_PRICE', 'MAX_DISCOUNT_PERCENT', 'MAX_DISCOUNT_AMOUNT')),
  min_price DECIMAL(12,2),
  max_discount_percent DECIMAL(5,2),
  max_discount_amount DECIMAL(12,2),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pricing_restrictions_value_bounds CHECK (
    (min_price IS NULL OR min_price >= 0)
    AND (max_discount_percent IS NULL OR (max_discount_percent >= 0 AND max_discount_percent <= 100))
    AND (max_discount_amount IS NULL OR max_discount_amount >= 0)
  ),
  CONSTRAINT pricing_restrictions_mutually_exclusive CHECK (
    (restriction_type = 'MINIMUM_PRICE'
      AND min_price IS NOT NULL AND max_discount_percent IS NULL AND max_discount_amount IS NULL)
    OR (restriction_type = 'MAX_DISCOUNT_PERCENT'
      AND max_discount_percent IS NOT NULL AND min_price IS NULL AND max_discount_amount IS NULL)
    OR (restriction_type = 'MAX_DISCOUNT_AMOUNT'
      AND max_discount_amount IS NOT NULL AND min_price IS NULL AND max_discount_percent IS NULL)
  )
);
