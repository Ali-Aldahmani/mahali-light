# Database compatibility (slice 01)

## Policy

- One production PostgreSQL database already used by Express.
- No new production database, no replacement tables, no schema redesign, no destructive Alembic autogenerate.

## Access

SQLAlchemy 2.x `create_engine("postgresql+psycopg://...")` sync sessions. Queries use `sqlalchemy.text` with bound params.

## Tables read (SELECT only)

| Table | Endpoints |
| --- | --- |
| `user_sessions`, `users`, `roles`, `role_permissions`, `permissions`, `user_permissions` | authz on every protected route |
| `reorder_recommendations` | reorder list/get |
| `annual_stock_plans` | annual plan list/get |
| `product_variants`, `products`, `product_categories` | forecast joins |
| `invoices`, `invoice_items` | KPIs (confirmed only), sparkline, peak hours |
| `bill_payments`, `one_time_expenses` | KPI expenses |
| `customers` | KPI receivables (`credit_balance > 0`) |
| `purchase_orders` | KPI payables (`balance_due > 0`, not cancelled) |
| `return_orders` | KPI refunds / returned value |
| `sales_history_monthly` | product seasonality |

## Legacy compromises

- No SQLAlchemy mapped classes for these tables (avoids type coercion drift).
- Financial JSON numbers are `float` **after** `Decimal` half-up to 2 places, matching Express `Math.round(n*100)/100` / `::float8` then `Number`.
- `JSON_AGG` month rows pass through driver JSON (same as node-pg).
- GET-by-id forecast **does not** upsert missing recommendation/plan rows (Express write-on-read). See `KNOWN_DIFFERENCES.md`.

## Timezone

| Concern | Behavior (copied from Express) |
| --- | --- |
| Default KPI/peak range | Process **local** year/month, formatted via UTC date constructor (`Date.UTC` / Python `date(y,m,1).isoformat()` — equivalent calendar dates) |
| `confirmed_at::date` | Postgres session `TimeZone` |
| Sparkline buckets | `CURRENT_DATE` in Postgres |
| Peak hour | `EXTRACT(HOUR FROM confirmed_at)` in Postgres TZ |
| Seasonality cutoff | Process local `Date` / `datetime.now()` |

Do not switch these to a shop timezone without an Express change.
