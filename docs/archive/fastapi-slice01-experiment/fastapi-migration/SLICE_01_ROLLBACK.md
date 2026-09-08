# Slice 01 rollback

## Immediate rollback (STATE 3)

1. Set `FASTAPI_SLICE01_ENABLED=false` (and `FASTAPI_SLICE01_SHADOW=false` if it was on).
2. Restart the **Express** process (`pm2 restart mahali-light`, Docker `api` recreate, or local nodemon restart).
3. Confirm logs: `[slice01] enabled=false`.
4. Confirm `GET /api/health` → `data.slice01.enabled` is false.
5. Hit `GET /api/forecast/reorder` with a valid JWT — response header `x-mahali-backend` must be **absent** (Express).

No database migration, no frontend rebuild, no session reset, no data conversion.

Express Slice 01 handlers are **not** deleted.

## Optional

Stop the FastAPI container (`docker compose --profile fastapi stop fastapi`). Not required for correctness once the flag is off.
