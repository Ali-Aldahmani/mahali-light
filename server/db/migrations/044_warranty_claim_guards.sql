-- Migration 044: one open claim per warranty (warranty audit F16).
--
-- Two open claims on one warranty could each be resolved as a replacement,
-- handing out two units for one. The service now refuses a second open
-- claim under the warranty lock; this index makes the database refuse it
-- too. Finished claims (resolved/rejected) are history and don't count.
--
-- If existing data already has two open claims on one warranty the index
-- can't be built; it is skipped with a notice instead of failing the
-- upgrade, and the service check still applies. Close the duplicates and
-- re-run this statement by hand to add the index.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM warranty_claims
     WHERE status IN ('open', 'in_progress') AND warranty_id IS NOT NULL
     GROUP BY warranty_id HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'warranty_claims has warranties with more than one open claim; uq_warranty_claims_one_open not created';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_warranty_claims_one_open
      ON warranty_claims (warranty_id)
      WHERE status IN ('open', 'in_progress');
  END IF;
END $$;
