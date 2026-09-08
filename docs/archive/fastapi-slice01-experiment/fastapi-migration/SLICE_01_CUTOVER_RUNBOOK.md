# Slice 01 controlled cutover runbook

## States

| State | Flags | User response |
| --- | --- | --- |
| 0 Express only | `FASTAPI_SLICE01_ENABLED=false` (default) | Express |
| 1 Shadow | `ENABLED=true` **and** `SHADOW=true` | Express; FastAPI compared in background |
| 2 FastAPI Slice 01 | `ENABLED=true`, `SHADOW=false` | Allowlisted GETs from FastAPI |
| 3 Rollback | `ENABLED=false` | Express immediately after Express restart |

`FASTAPI_SLICE01_FALLBACK=true` (default): transport failure / timeout → Express.  
`FASTAPI_SLICE01_FALLBACK_ON_5XX=false` (default): FastAPI 5xx is returned, not hidden by Express.

## Preflight

- FastAPI `GET /health` → `database: up`
- Express `GET /api/health` → `status: ok`
- Same `JWT_SECRET` and PostgreSQL as Express
- Shop DB: `RUN_PARITY=1` Slice 01 matrix (do not commit customer payloads)

## Health checks

```bash
curl -sS "$EXPRESS/api/health"
curl -sS "$FASTAPI/health"
```

## Target DB parity

Record only pass/fail per route in the shop change ticket. Do not paste production JSON into git.

## Enable shadow (STATE 1)

1. Start FastAPI (compose profile `fastapi` or `uvicorn` on `FASTAPI_BASE_URL`).
2. `FASTAPI_SLICE01_ENABLED=true` `FASTAPI_SLICE01_SHADOW=true` — restart Express.
3. Use the till normally. Watch `slice01_cutover` logs for `mismatch: true`.
4. Stay here until mismatches are understood.

## Observe

Counters: `GET /api/health` → `data.slice01.metrics` (`fastapi`, `express`, `fallbacks`, `transportFailures`, `mismatches`).

## Enable FastAPI (STATE 2)

1. `FASTAPI_SLICE01_SHADOW=false`, keep `ENABLED=true`, restart Express.
2. Verify `x-mahali-backend: FASTAPI` on a Slice 01 GET.
3. Verify unverified routes (e.g. `/api/analytics/daily-snapshot`) have no that header.

## Verify

- Login, dashboard KPIs, reorder list, peak hours, seasonality.
- Invalid JWT still 401 from FastAPI (no Express fallback).
- POS confirm / stock still Express.

## Rollback conditions

Repeated transport failures, unexplained 5xx, KPI/reorder mismatch vs Express, FastAPI process crash loop.

## Rollback steps

See `SLICE_01_ROLLBACK.md`.

## Post-cutover

Keep Express handlers. Do not start Slice 02 until Slice 01 is stable in production.
