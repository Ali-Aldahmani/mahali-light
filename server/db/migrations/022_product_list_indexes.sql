-- Migration 022: indexes for large product catalogs (10 000+ products).
--
-- At scale the products list endpoint was bottlenecked on:
--   1. Sequential scans on is_active / category_id / sold_by / has_variants
--      filter columns — no individual indexes existed.
--   2. ILIKE '%term%' text searches doing full-table scans on name and brand
--      (leading wildcard defeats B-tree indexes; requires trigram GIN).
--   3. The batch variant loader (loadVariantsBatch) scanning product_variants
--      without a partial index covering the is_active = true predicate.
--
-- CONCURRENTLY is intentionally omitted from all statements below.
-- This migration runs inside migrate.js's explicit transaction block at server
-- startup (before any traffic is served).  PostgreSQL forbids CREATE INDEX
-- CONCURRENTLY inside a transaction; non-concurrent builds are safe here.

-- ── products ──────────────────────────────────────────────────────────────

-- Composite index covering the most common list query pattern:
--   WHERE is_active = <bool> ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_products_is_active_updated_at
    ON products (is_active, updated_at DESC);

-- Category filter (used by the recursive category descendant query)
CREATE INDEX IF NOT EXISTS idx_products_category_id
    ON products (category_id)
    WHERE category_id IS NOT NULL;

-- Enum filters
CREATE INDEX IF NOT EXISTS idx_products_sold_by
    ON products (sold_by);

CREATE INDEX IF NOT EXISTS idx_products_has_variants
    ON products (has_variants);

-- ── Text search — trigram GIN indexes (requires pg_trgm) ──────────────────
--
-- ILIKE '%term%' with a leading wildcard cannot use B-tree indexes.
-- pg_trgm GIN indexes let the planner answer ILIKE queries efficiently.
-- This drops text search from O(rows) to near-O(log rows) at any catalog size.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_brand_trgm
    ON products USING gin (brand gin_trgm_ops)
    WHERE brand IS NOT NULL;

-- ── product_variants ──────────────────────────────────────────────────────

-- Partial index used by loadVariantsBatch / loadVariants — only active rows,
-- which are the only ones the application ever fetches.
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id_active
    ON product_variants (product_id)
    WHERE is_active = true;

-- Barcode / SKU lookups used by the POS search endpoint
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode
    ON product_variants (barcode)
    WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_variants_internal_barcode
    ON product_variants (internal_barcode)
    WHERE internal_barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_variants_sku_trgm
    ON product_variants USING gin (sku gin_trgm_ops)
    WHERE sku IS NOT NULL;
