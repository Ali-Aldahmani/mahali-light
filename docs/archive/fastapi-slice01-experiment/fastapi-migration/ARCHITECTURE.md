# Slice 01 architecture

## Processes

| Process | Port (typical local) | Role |
| --- | --- | --- |
| Express | 3000 / 3002 | Production HTTP + Socket.io + JWT issuance |
| FastAPI | 8000 | Read-only `/api/v2/forecast/*` and `/api/v2/analytics/*` + `/health` |
| PostgreSQL | 5432 | Single catalog |

React/Vite and Electron still call Express only.

## Request path (this slice)

```
Client (tests / curl)
  ├─ GET /api/forecast/...     → Express
  └─ GET /api/v2/forecast/...  → FastAPI
         │
         ├─ JWT HS256 verify (same JWT_SECRET)
         ├─ SHA-256 token → user_sessions.token_hash
         ├─ loadUserContext SQL (role_permissions + user_permissions)
         ├─ requirePermission AND of slice keys
         └─ copied SELECT SQL (no writes)
```

## Stack choices

- Python 3.11+, FastAPI, Uvicorn
- SQLAlchemy 2 **sync** + psycopg 3 — one style, matches Express request/response (no async pool split)
- No ORM models for legacy tables — `text()` SQL copied from Express services so joins/filters stay identical

## Isolation

Code lives in `backend-fastapi/`. Express tree is not reorganized. Compose `fastapi` service is behind profile `fastapi`.
