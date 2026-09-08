# Slice 01 scope — FastAPI read-only strangler

Approved from `docs/migration-contracts/FASTAPI_MIGRATION_ORDER.md` and
`docs/migration-contracts/fixtures/analytics-forecast/README.md`.

No additional endpoints were added because they looked easy.

Express routes stay mounted. FastAPI serves the same handlers under `/api/v2`.

## Migrated endpoints

### 1. GET reorder list

| | |
| --- | --- |
| FastAPI | `GET /api/v2/forecast/reorder` |
| Express | `GET /api/forecast/reorder` |
| Source | `server/routes/forecast.js`, `server/controllers/analyticsController.js` `listReorder`, `server/services/forecastService.js` `listReorderRecommendations` |
| Permission | `analytics.view_reorder` |
| Input | Query `low_stock_only` (Zod coerce boolean; non-empty string is true), `category_id` optional UUID |
| Output | `{ success: true, data: Item[] }` — empty array when no rows. Item shape in `GET_forecast_reorder.json` |
| Tables | `reorder_recommendations`, `product_variants`, `products`, `product_categories` |
| Business rules | AUTH-002, AUTHZ-001, AUTHZ-002, AUTHZ-006, INV-006 |
| NOT_VERIFIED | none for list shape; populated capture: `tests/migration/slice01Dataset.js` |

### 2. GET reorder by variant

| | |
| --- | --- |
| FastAPI | `GET /api/v2/forecast/reorder/{variantId}` |
| Express | `GET /api/forecast/reorder/:variantId` |
| Source | `analyticsController.getReorder`, `forecastService.getReorderForVariant` |
| Permission | `analytics.view_reorder` |
| Input | Path UUID |
| Output | Object without list-only fields (`peak_multiplier` not in GET-one mapper) |
| Tables | same as list |
| Express extra | **CORRECTED:** read-only. Missing row → 404 `RESOURCE_NOT_FOUND` (`Variant not found.`). Writes: `POST /api/forecast/recalculate` + monthly job. |
| NOT_VERIFIED | none for error code (canonical `RESOURCE_NOT_FOUND`) |

### 3. GET annual plan list

| | |
| --- | --- |
| FastAPI | `GET /api/v2/forecast/annual-plan` |
| Express | `GET /api/forecast/annual-plan` |
| Source | `listAnnualPlan` |
| Permission | `analytics.view_reorder` |
| Input | `year` 2000–2100 optional (default calendar year of process), `category_id` optional UUID |
| Output | Array of product plans with `months` JSON_AGG, `total_qty`, `total_cost` |
| Tables | `annual_stock_plans`, `product_variants`, `products`, `product_categories` |

### 4. GET annual plan by variant

| | |
| --- | --- |
| FastAPI | `GET /api/v2/forecast/annual-plan/{variantId}` |
| Express | `GET /api/forecast/annual-plan/:variantId` |
| Source | `getAnnualPlanForVariant` |
| Permission | `analytics.view_reorder` |
| Express extra | **CORRECTED:** read-only. Missing year rows → 404 `RESOURCE_NOT_FOUND`. |

### 5. GET KPIs

| | |
| --- | --- |
| FastAPI | `GET /api/v2/analytics/kpis` |
| Express | `GET /api/analytics/kpis` |
| Source | `analyticsController.kpis`, `analyticsService.getKPIs` |
| Permission | `analytics.view_dashboard` |
| Input | optional `start_date`, `end_date` (`YYYY-MM-DD`). **CORRECTED:** `getKPIs` uses `parseDateRange(params)` so snake_case query keys apply. Invalid date → 400 `VALIDATION_FAILED`. Inverted range → 400 `VAL_INVALID_DATE_RANGE`. Default: current local calendar month. |
| Output | See `GET_analytics_kpis.json` |
| Tables | `invoices`, `invoice_items`, `bill_payments`, `one_time_expenses`, `customers`, `purchase_orders`, `return_orders`, `product_variants` |
| Filters | invoices `status = 'confirmed'` only; POs `status <> 'cancelled'` for payables |

### 6. GET sparkline

| | |
| --- | --- |
| FastAPI | `GET /api/v2/analytics/sparkline` |
| Express | `GET /api/analytics/sparkline` |
| Permission | `analytics.view_dashboard` |
| Input | `metric` `revenue`\|`orders` default revenue; `days` 1–60 default 7 |
| Tables | `invoices` (`CURRENT_DATE` = Postgres session timezone) |

### 7. GET peak hours

| | |
| --- | --- |
| FastAPI | `GET /api/v2/analytics/peak-hours` |
| Express | `GET /api/analytics/peak-hours` |
| Permission | `analytics.view_peaks` |
| Input | optional `start_date`/`end_date` (same validation as KPIs). **CORRECTED:** query keys apply. |
| Tables | `invoices` confirmed; `EXTRACT(HOUR FROM confirmed_at)` uses **Postgres TimeZone** |
| Output | 24-hour `series`, `peak_hours` top 3 by count, `slow_hours` last 3 with count>0 |

### 8. GET product seasonality

| | |
| --- | --- |
| FastAPI | `GET /api/v2/analytics/product-seasonality/{id}` |
| Express | `GET /api/analytics/product-seasonality/:id` |
| Permission | `analytics.view_seasonality` |
| Input | `years` 1–5 default 2 |
| Tables | `sales_history_monthly` |
| Time | Local `new Date()` year/month; series stops using Express `m > getMonth()` (0-indexed) |

## Explicitly out of slice

`POST /api/forecast/recalculate`, dismiss, xlsx export, daily-snapshot, sales-timeline, category-breakdown, net-profit-trends, top/worst products/suppliers/customers, employee-performance, peak-days/heatmap/months, all writes, auth, RBAC admin, POS, stock, invoices, returns, finance, Socket.io, Electron.

## Frontend / Electron

Unchanged. No React cutover.
