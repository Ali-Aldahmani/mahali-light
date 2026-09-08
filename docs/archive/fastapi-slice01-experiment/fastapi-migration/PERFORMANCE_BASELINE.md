# Performance baseline — slice 01 (after contract fix)

Local sample 2026-09-08, same PostgreSQL, synthetic fixture present. Not a bake-off.

| Endpoint | Express ms | FastAPI ms |
| --- | --- | --- |
| GET forecast/reorder (2 rows) | 25 | 102 (cold first FastAPI) |
| GET analytics/kpis (Jan 2024) | 19 | 17 |
| GET analytics/peak-hours (Jan 2024) | 29 | 8 |

GET missing-variant does not increase `reorder_recommendations` or `annual_stock_plans` counts. No extra permission-loop or N+1 added. Auth still 4 SQL + 1 domain query.
