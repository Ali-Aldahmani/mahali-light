# Forecast / reorder persisted data ownership

## Classification

`reorder_recommendations` and `annual_stock_plans` are **persisted derived cache** (option A), produced by an explicit write path.

They are **not** source-of-truth business documents. Truth for demand is confirmed invoices / `sales_history_monthly`. They are **not** computed purely in memory on every GET: the list UI reads the tables. They **are** scheduled/precomputed artifacts (option D) as well: monthly cron + `POST /api/forecast/recalculate`.

## Evidence

| Writer | When |
| --- | --- |
| `calculateReorderRecommendation` | UPSERT `reorder_recommendations` ON CONFLICT `(variant_id)` |
| `calculateAnnualStockPlan` | DELETE year then INSERT 12 months |
| `runAllForecasts` | Called by `POST /api/forecast/recalculate` (`analytics.manage_reorder_settings`) and `startForecastJob` (1st of month 02:00) |
| `GET /api/forecast/reorder/:id` (OLD) | Called calculate when no row — **removed** |
| `GET /api/forecast/annual-plan/:id` (OLD) | Same — **removed** |

Readers: list/get forecast APIs, Excel export (`listAnnualPlan` only), Analytics ReorderTable / AnnualPlanTable (list + Recalculate button). `getReorderForVariant` / `getAnnualPlanForVariant` are unused by the current Analytics page.

No notifications/alerts join these tables in Slice 01. Stock `reorder_alerts` is a different table.

## Product-preserving choice

Keep persistence via **existing** `POST /api/forecast/recalculate` and the monthly job. GET is read-only; missing cache → `404 RESOURCE_NOT_FOUND`. No new public write API.
