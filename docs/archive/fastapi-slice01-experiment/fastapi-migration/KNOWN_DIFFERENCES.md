# Known differences — slice 01

## OLD VERIFIED BEHAVIOR (pre-contract-fix)

1. Express GET variant forecast **wrote** (UPSERT / DELETE+INSERT) when cache rows were missing.
2. Express used undefined `ERROR_CODES.NOT_FOUND`.
3. Express `getKPIs` / `getPeakHours` ignored public `start_date` / `end_date` because the service destructured `startDate` / `endDate`. FastAPI copied that bug for parity.

## CORRECTED CONTRACT

1. GET is read-only on Express and FastAPI. Missing cache → **404 `RESOURCE_NOT_FOUND`**, message `Variant not found.`
2. Writes stay on Express `POST /api/forecast/recalculate` and the monthly forecast job.
3. Slice 01 KPIs and peak-hours honor `start_date` / `end_date`. Invalid calendar date → 400 `VALIDATION_FAILED` (`field` start_date/end_date). `start_date` > `end_date` after defaults → 400 `VAL_INVALID_DATE_RANGE`.

## RATIONALE

GET must be idempotent for strangler parity. Cache tables are derived; generation already had an explicit write API. Analytics dashboard already sent `start_date`/`end_date`; ignoring them was a mapping bug, not a product rule.

## MIGRATION IMPACT

FastAPI `/api/v2` matches the **corrected** Express contract. React still calls Express. Do not steal routes until this matrix is green in the target environment.

Acceptable remaining serialization: Zod vs FastAPI validation **wording** for enum/min/max; JSON numbers vs `0` vs `0.0` where values are equal.
