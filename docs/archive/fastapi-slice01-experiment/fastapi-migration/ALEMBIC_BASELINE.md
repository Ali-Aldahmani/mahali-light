# Alembic baseline (FastAPI)

Express `server/db/migrations` is the **only** source of truth for the current POS schema.

`backend-fastapi/alembic` exists so future **FastAPI-owned** tables/columns can be versioned later. It is **not** a dump of `reorder_recommendations`, `invoices`, etc.

## Forbidden

- `alembic revision --autogenerate` against a live mahali database
- Generating migrations that recreate or drop existing Express tables
- Applying a “baseline stamp” that implies FastAPI owns the catalog

## Current configuration

- `target_metadata = None`
- Offline migrations raise
- Online migrations raise unless `-x allow_fastapi_owned=1`

When FastAPI eventually needs a new table, add an explicit revision with hand-written SQL, review it, then allow that flag in a controlled environment — never autogenerate against production.
