-- The product reference seed (server/db/seedProducts.js) ran at every server
-- start. Its root-category INSERT used ON CONFLICT DO NOTHING, but
-- product_categories has no unique constraint, so nothing ever conflicted:
-- each start added seven more root categories, and the follow-up UPDATE reset
-- description, requires_serial and sort_order on every category with those
-- names, undoing the shop's own edits (software engineering audit F-MIG-04).
--
-- This migration:
--   1. merges active categories that share a name under the same parent into
--      one, moving products, subcategories, stock counts, promotion items and
--      attribute links onto the one kept, and deactivates the others (the
--      same soft delete the Categories screen uses, so nothing is lost);
--   2. adds a unique index so it can't happen again;
--   3. records that the reference seed has been applied on installs that
--      already have categories, so it is never run again there.
--
-- Kept category in each group: the one with the most active products, then
-- the oldest. Its own settings are left as they are.

CREATE TABLE IF NOT EXISTS _seed_runs (
  name VARCHAR(100) PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  merged INT;
  total_merged INT := 0;
BEGIN
  -- Merging duplicate parents moves their subcategories under one parent,
  -- which can create new duplicates one level down, so repeat until none.
  LOOP
    CREATE TEMP TABLE _cat_merge ON COMMIT DROP AS
    WITH ranked AS (
      SELECT c.id,
             FIRST_VALUE(c.id) OVER w AS keep_id,
             ROW_NUMBER() OVER w AS rn
        FROM product_categories c
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS n
            FROM products p
           WHERE p.category_id = c.id AND p.is_active = true
        ) pc ON true
       WHERE c.is_active = true
      WINDOW w AS (
        PARTITION BY lower(btrim(c.name)), c.parent_id
        ORDER BY pc.n DESC, c.created_at ASC NULLS LAST, c.id ASC
      )
    )
    SELECT id AS dup_id, keep_id FROM ranked WHERE rn > 1;

    SELECT COUNT(*) INTO merged FROM _cat_merge;
    IF merged = 0 THEN
      DROP TABLE _cat_merge;
      EXIT;
    END IF;
    total_merged := total_merged + merged;

    UPDATE products p SET category_id = m.keep_id
      FROM _cat_merge m WHERE p.category_id = m.dup_id;

    UPDATE product_categories c SET parent_id = m.keep_id, updated_at = NOW()
      FROM _cat_merge m WHERE c.parent_id = m.dup_id;

    UPDATE stock_counts s SET category_id = m.keep_id
      FROM _cat_merge m WHERE s.category_id = m.dup_id;

    UPDATE promotion_items i SET category_id = m.keep_id
      FROM _cat_merge m WHERE i.category_id = m.dup_id;

    -- Attribute links: add the duplicate's links the kept category lacks,
    -- then drop the duplicate's (primary key is category_id, attribute_id).
    INSERT INTO category_attributes (category_id, attribute_id, is_required, display_order)
    SELECT m.keep_id, ca.attribute_id, ca.is_required, ca.display_order
      FROM category_attributes ca
      JOIN _cat_merge m ON m.dup_id = ca.category_id
    ON CONFLICT (category_id, attribute_id) DO NOTHING;

    DELETE FROM category_attributes ca
     USING _cat_merge m WHERE ca.category_id = m.dup_id;

    UPDATE product_categories c SET is_active = false, updated_at = NOW()
      FROM _cat_merge m WHERE c.id = m.dup_id;

    DROP TABLE _cat_merge;
  END LOOP;

  IF total_merged > 0 THEN
    RAISE NOTICE 'merged % duplicate product categor(y/ies)', total_merged;
  END IF;
END $$;

-- One active category per name under the same parent (case and surrounding
-- spaces ignored). Deactivated categories don't count, so a name can be
-- reused after a category is removed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_categories_active_name
  ON product_categories (lower(btrim(name)), COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active = true;

-- An install that already has categories was seeded long ago: never run the
-- reference seed there again. A fresh install has none at this point, and the
-- seed records itself after its first run.
INSERT INTO _seed_runs (name)
SELECT 'product_reference_data'
 WHERE EXISTS (SELECT 1 FROM product_categories)
ON CONFLICT DO NOTHING;
