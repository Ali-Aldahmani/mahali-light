# Current system baseline (source-verified)

Bytecra POS before the web/Docker cutover. Express remains the API after this work.

## Frontend

- Vite + React 18 (`src/`, `index.html`, `vite.config.js` port 5173, `base: './'`).
- Routing: `src/main.jsx` `BrowserRouter` + `src/App.jsx` routes (login, setup, POS, inventory, finance, analytics, …).
- HTTP: `src/services/http.js` axios; `baseURL` from `src/config.js`.
- Auth token: Zustand persist `sessionStorage` key `mahali-light.auth` (`src/store/authStore.js`). Not localStorage.
- UI permissions: `PermissionGate` / `ProtectedRoute` are UX only. Express enforces RBAC.

## Express

- `server/index.js` listens `0.0.0.0`, `PORT` default 3002 (Docker 3000).
- JWT HS256, `user_sessions.token_hash` SHA-256, force logout, role + `user_permissions` grant/deny.
- Socket.io in `server/socket/index.js` (JWT handshake, rooms, heartbeat).
- PostgreSQL via `server/db/postgres.js` (`pg` Pool). Migrations `server/db/migrations`.
- Uploads `/files`. Backups `server/backup/*` (`pg_dump`, NAS, USB via `drivelist` on the **server** host).

## Electron (optional till shell)

- `electron/main.js` + `preload.js`: print PDFs, USB list, backup download save-dialog, screenshot, window, config, TLS exception for configured IP.
- Production previously: Docker API + Electron tills. UI was **not** in the API image.

## FastAPI (retired as POS sidecar)

- Was Slice 01 strangler under `backend-fastapi/` and `server/migration/*`.
- Experiment archived: `docs/archive/fastapi-slice01-experiment/`.

## Docker (before)

- `postgres` + `api` only. Postgres unpublished. Frontend not served.
