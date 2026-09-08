# Slice 01 cutover architecture

## Decision

**Express compatibility proxy** mounted in `server/index.js` **before** `/api/analytics` and `/api/forecast` routers.

Reasons (repository evidence):

- Tills already call a single Express origin (`VITE_SERVER_IP` / Electron). There is no reverse-proxy config in-repo for path stealing.
- Only **8 GETs** are verified; `/api/analytics/*` would wrongly send daily-snapshot, net-profit, etc. to FastAPI.
- Public URL stays `/api/...`. React is unchanged.
- FastAPI process is optional (`docker compose` profile `fastapi`). Express must boot if FastAPI is down.

FastAPI continues to expose `/api/v2/...` for direct parity tests. Production clients do not use `/api/v2`.

```
Renderer /api/forecast/reorder
        │
        v
Express :3000
  slice01 middleware (allowlist GET)
        │
        ├─ flag off / shadow / circuit open / transport fail → existing Express handlers
        └─ flag on → GET FastAPI /api/v2/forecast/reorder (same query + Authorization)
```

## Allowlist

See `server/migration/slice01Routes.js` and `docs/fastapi-migration/SLICE_01_PARITY_MATRIX.md`.

## Auth

Bearer header copied byte-for-byte. FastAPI validates JWT + `user_sessions` as today. Express does not re-issue tokens.

Shadow mode requires **both** `FASTAPI_SLICE01_ENABLED=true` and `FASTAPI_SLICE01_SHADOW=true`. Shadow alone does not call FastAPI.

`user_id` is logged when Express auth has already populated `req.user` (typically shadow/fallback after the analytics/forecast stack). FastAPI-served responses skip Express auth, so user id is omitted rather than decoded from the JWT in the proxy.

## Timeouts

`FASTAPI_SLICE01_TIMEOUT_MS` (default 5000). Abort; **no retry**. Transport timeout or connection failure then follows the fallback policy.

## Fail-safe

After `FASTAPI_SLICE01_FAIL_THRESHOLD` consecutive **transport** failures (default 5), FastAPI routing is skipped for the rest of the Express process (`circuitOpen`). Restart Express (or a successful FastAPI call before the threshold) clears consecutive failures; opening the circuit requires a process restart to serve FastAPI again (deterministic, no hidden half-open probes).

## Startup

Express does **not** wait for FastAPI. POS login, invoices, sockets remain available with the flag off or FastAPI down (fallback).
