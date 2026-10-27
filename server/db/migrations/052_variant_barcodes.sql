-- Migration 052: one barcode, one product (inventory audit INV-003).
--
-- A variant has three scannable codes: internal_barcode, barcode (the same
-- value today) and supplier_barcode. Only internal_barcode was unique, so a
-- supplier code could equal another product's primary code, and a scan
-- matched whichever row PostgreSQL returned first.
--
-- variant_barcodes holds every code of every ACTIVE variant once, compared
-- trimmed and in upper case, with a unique index. A trigger keeps it in step
-- with product_variants for every writer (screens, imports, scripts):
--   * a new or changed code that another active variant already has is
--     refused (SQLSTATE 23505, constraint uq_variant_barcodes_code), which
--     the API reports as "Barcode … is already used by …";
--   * deactivating a variant frees its codes;
--   * a code that clashed BEFORE this migration stays with the variant that
--     registered it first (oldest variant; internal, then primary, then
--     supplier code). The other variant can still be edited; its copy just
--     doesn't match a scan. scripts/reconcile.js lists such clashes
--     ("barcode_collisions") so they can be cleaned up.
-- Scans read this table, so a code always finds exactly one product.

CREATE TABLE IF NOT EXISTS variant_barcodes (
  code       VARCHAR(100) NOT NULL,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  kind       VARCHAR(10) NOT NULL CHECK (kind IN ('internal', 'primary', 'supplier')),
  CONSTRAINT uq_variant_barcodes_code UNIQUE (code)
);
CREATE INDEX IF NOT EXISTS idx_variant_barcodes_variant ON variant_barcodes (variant_id);

CREATE OR REPLACE FUNCTION normalize_barcode(raw TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(upper(btrim(raw)), '') $$;

-- Register the existing codes, oldest variant first.
INSERT INTO variant_barcodes (code, variant_id, kind)
SELECT code, variant_id, kind FROM (
  SELECT normalize_barcode(c.code) AS code, v.id AS variant_id, c.kind,
         v.created_at, c.priority
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    CROSS JOIN LATERAL (VALUES
      (v.internal_barcode, 'internal', 1),
      (v.barcode, 'primary', 2),
      (v.supplier_barcode, 'supplier', 3)
    ) c(code, kind, priority)
   WHERE v.is_active AND p.is_active
) codes
WHERE code IS NOT NULL
ORDER BY created_at, variant_id, priority
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_variant_barcodes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item RECORD;
  owner UUID;
  owner_name TEXT;
  old_codes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Without NULLs: "code = ANY(array with a NULL)" is NULL, not false.
    old_codes := array_remove(ARRAY[normalize_barcode(OLD.internal_barcode),
                                    normalize_barcode(OLD.barcode),
                                    normalize_barcode(OLD.supplier_barcode)], NULL);
  END IF;

  IF NOT NEW.is_active OR NOT COALESCE((SELECT is_active FROM products WHERE id = NEW.product_id), true) THEN
    DELETE FROM variant_barcodes WHERE variant_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Codes this variant no longer has.
  DELETE FROM variant_barcodes
   WHERE variant_id = NEW.id
     AND code IS DISTINCT FROM normalize_barcode(NEW.internal_barcode)
     AND code IS DISTINCT FROM normalize_barcode(NEW.barcode)
     AND code IS DISTINCT FROM normalize_barcode(NEW.supplier_barcode);

  FOR item IN
    SELECT normalize_barcode(c.code) AS code, c.kind
      FROM (VALUES (NEW.internal_barcode, 'internal'),
                   (NEW.barcode, 'primary'),
                   (NEW.supplier_barcode, 'supplier')) c(code, kind)
  LOOP
    CONTINUE WHEN item.code IS NULL;
    SELECT variant_id INTO owner FROM variant_barcodes WHERE code = item.code;
    IF owner IS NULL THEN
      INSERT INTO variant_barcodes (code, variant_id, kind) VALUES (item.code, NEW.id, item.kind);
    ELSIF owner <> NEW.id AND NOT (item.code = ANY (old_codes)) THEN
      SELECT p.name INTO owner_name
        FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = owner;
      RAISE EXCEPTION 'Barcode % is already used by %.', item.code, COALESCE(owner_name, 'another product')
        USING ERRCODE = '23505', CONSTRAINT = 'uq_variant_barcodes_code',
              DETAIL = item.code;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_variant_barcodes ON product_variants;
CREATE TRIGGER trg_sync_variant_barcodes
  AFTER INSERT OR UPDATE OF internal_barcode, barcode, supplier_barcode, is_active
  ON product_variants
  FOR EACH ROW EXECUTE FUNCTION sync_variant_barcodes();

-- Products can be deactivated as a whole; their variants' codes are freed
-- and come back when the product is reactivated.
CREATE OR REPLACE FUNCTION sync_product_barcodes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    -- Re-run the variant trigger for each variant: it drops the codes of a
    -- deactivated product and re-registers them on reactivation (a code
    -- another product took meanwhile stays with that product).
    UPDATE product_variants SET is_active = is_active WHERE product_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_product_barcodes ON products;
CREATE TRIGGER trg_sync_product_barcodes
  AFTER UPDATE OF is_active ON products
  FOR EACH ROW EXECUTE FUNCTION sync_product_barcodes();

DO $$
DECLARE clashes INT;
BEGIN
  SELECT COUNT(*) INTO clashes FROM (
    SELECT normalize_barcode(c.code)
      FROM product_variants v
      CROSS JOIN LATERAL (VALUES (v.internal_barcode), (v.barcode), (v.supplier_barcode)) c(code)
      JOIN products p ON p.id = v.product_id
     WHERE v.is_active AND p.is_active AND normalize_barcode(c.code) IS NOT NULL
     GROUP BY 1 HAVING COUNT(DISTINCT v.id) > 1
  ) x;
  IF clashes > 0 THEN
    RAISE NOTICE '% barcode(s) belong to more than one product; the oldest product keeps each. Run scripts/reconcile.js to list them.', clashes;
  END IF;
END $$;
