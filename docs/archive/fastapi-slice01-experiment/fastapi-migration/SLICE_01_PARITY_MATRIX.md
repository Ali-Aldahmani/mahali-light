# Slice 01 parity matrix

Live comparison uses the same PostgreSQL, JWT, and `tests/migration/slice01Dataset.js` rows.

| Express | FastAPI | Auth | Authz | Query validation | Status | Error code | Shape | Populated | Empty | Date filter | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET `/api/forecast/reorder` | GET `/api/v2/forecast/reorder` | JWT+session | `analytics.view_reorder` | uuid `category_id`, coerce bool | 200/401/403/400 | AUTH_* / VALIDATION_FAILED | list | yes | `[]` | n/a | VERIFIED |
| GET `/api/forecast/reorder/:variantId` | GET `/api/v2/forecast/reorder/:variantId` | same | same | path id | 200/404 | RESOURCE_NOT_FOUND | object | yes | 404 | n/a | VERIFIED |
| GET `/api/forecast/annual-plan` | GET `/api/v2/forecast/annual-plan` | same | same | year, uuid | 200 | | list | yes | `[]` | n/a (year) | VERIFIED |
| GET `/api/forecast/annual-plan/:variantId` | GET `/api/v2/forecast/annual-plan/:variantId` | same | same | year | 200/404 | RESOURCE_NOT_FOUND | object | yes | 404 | n/a | VERIFIED |
| GET `/api/analytics/kpis` | GET `/api/v2/analytics/kpis` | same | `analytics.view_dashboard` | ISO dates, inverted range | 200/400 | VALIDATION_FAILED / VAL_INVALID_DATE_RANGE | KPI object | yes | zeros | `start_date`/`end_date` | VERIFIED |
| GET `/api/analytics/sparkline` | GET `/api/v2/analytics/sparkline` | same | dashboard | metric, days | 200/400 | | series | yes | zero days | n/a (`days`) | VERIFIED |
| GET `/api/analytics/peak-hours` | GET `/api/v2/analytics/peak-hours` | same | `analytics.view_peaks` | ISO dates | 200/400/403 | | 24h series | yes | zeros | `start_date`/`end_date` | VERIFIED |
| GET `/api/analytics/product-seasonality/:id` | GET `/api/v2/analytics/product-seasonality/:id` | same | `analytics.view_seasonality` | years 1–5 | 200 | | series | rich + thin history | empty series | n/a | VERIFIED |

`calculated_at` is the only stripped field (timestamptz stringify). GET performs no writes on either process.

No INTENTIONAL_DIFFERENCE remaining for Slice 01.
