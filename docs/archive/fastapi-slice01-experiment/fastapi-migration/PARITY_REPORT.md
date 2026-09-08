# Parity report — slice 01 (after contract fix)

## OLD vs CORRECTED

See `KNOWN_DIFFERENCES.md`. Live tests now require `RUN_PARITY=1`.

## Live results (2026-09-08)

Synthetic dataset `tests/migration/slice01Dataset.js` (tagged `slice01-parity-fixture`, cleaned after tests).

Vitest `tests/migration/fastapi-slice-01-parity.test.js`: **8 passed** (unauth, invalid query, dates, cashier 403, missing 404, populated+filters, GET no-write).

Pytest `tests/test_parity_live.py`: **2 passed** with `RUN_PARITY=1`.

KPI `invoice_count` inside 2024-01: **3**; outside 2023-01: **0** (date filter works on both sides).
