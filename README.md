# Bytecra POS (Mahali Light)

Multi-PC Electron POS for electrical retail (UAE). **Windows tills** in the shop: one **server PC** (PostgreSQL + API) and any number of **client PCs**.

**Shop install (multiple Windows PCs):** **[docker/README.md](docker/README.md)** (Docker API + Postgres) or **[docs/SHOP_MULTI_PC.md](docs/SHOP_MULTI_PC.md)** (PM2).


Developer Mac / local loop: [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) and `npm run dev`.


A multi-PC POS application for an electrical retail store in the UAE, built as:

- **Electron** — desktop shell on each client PC
- **React + Vite + Tailwind CSS** — frontend
- **Express.js** — API server on the central server PC
- **PostgreSQL** — main database
- **Socket.io** — real-time presence and force-logout
- **JWT** — authentication

This repository currently contains **Phase 1 — Authentication & Users**. The
data model and APIs are designed to be extended in later phases (POS,
inventory, customers, suppliers, attendance, finance, reporting, etc.).

---

## Prerequisites

- Node.js 18+ (20/22 recommended)
- PostgreSQL 14+
- npm 9+
- (Windows only) Build tools for `bcrypt` are usually unnecessary — npm installs
  the prebuilt binary. If install fails on your platform, replace `bcrypt`
  with `bcryptjs` in `package.json` (the two libraries share the same API).

## 1) Configure

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

Important variables:

| Variable        | Description                                  | Default                 |
| --------------- | -------------------------------------------- | ----------------------- |
| `PORT`          | API + socket server port                     | `3000`                  |
| `JWT_SECRET`    | Long random string — **change in prod**      | (see `.env.example`)    |
| `JWT_EXPIRES_IN`| JWT lifetime                                 | `8h`                    |
| `PGHOST/PORT/USER/PASSWORD/DATABASE` | PostgreSQL connection      | local defaults          |
| `BCRYPT_ROUNDS` | bcrypt cost                                  | `12`                    |
| `VITE_SERVER_IP`| Server LAN IP used by the frontend in dev    | `127.0.0.1`             |

In a real multi-PC deployment, every client Electron app reads the server IP
from a local config file. `electron/main.js` exposes that via the
`window.electron.serverIp` global; `src/config.js` consumes it.

## 2) Install

```bash
npm install
```

## 3) Database

Create an empty PostgreSQL database matching `PGDATABASE` (default
`mahali_light`). The server runs migrations and seeds automatically on
startup. You can also run them manually:

```bash
npm run migrate     # runs all SQL files in server/db/migrations
npm run seed        # seeds roles + permissions + the default admin user
```

The default admin login is created on first seed:

- **Username:** `admin`
- **Password:** `admin123`

> **Important:** change this password immediately in any non-dev environment.

## 4) Run

In development everything runs concurrently:

```bash
npm run dev
```

This boots:

- Vite (frontend) on http://localhost:5173
- Express API + Socket.io on http://localhost:3000
- Electron pointing at the Vite dev server

You can also run components individually:

```bash
npm run dev:server     # API only
npm run dev:vite       # frontend only
npm run dev:electron   # Electron pointing at Vite
```

## 5) Build

```bash
npm run build          # builds the React app to dist/
```

To package Electron for distribution, add `electron-builder` or `electron-forge`
in a follow-up phase.

---

## What's included in Phase 1

### Server (`server/`)

- `index.js` — Express app, runs migrations + seed on startup, attaches Socket.io
- `db/postgres.js` — connection pool + `withTransaction` helper
- `db/migrations/001_init.sql` — full Phase-1 schema (with `_migrations` tracker)
- `db/migrate.js` / `db/seed.js` — migration runner and idempotent seeder
- `middleware/auth.js` — JWT verification, session validation, `req.user` hydration
- `middleware/permissions.js` — `requirePermission('user.create', …)`
- `middleware/errors.js` — global error handler with standardized JSON shape
- `socket/index.js` — JWT-authenticated socket layer, heartbeats, idle sweep, force-logout
- `routes/` — `auth`, `users`, `employees`, `roles`, `presence`
- `controllers/` — corresponding business logic
- `utils/activityLog.js` — append-only audit trail writer
- `utils/response.js` — `ok`, `created`, `parsePagination`
- `utils/validate.js` — zod → express helper

### Shared (`shared/`)

- `errorCodes.js` — central error codes + `AppError` class
- `permissions.js` — permission key map + default permission sets per system role

### Electron (`electron/`)

- `main.js` — window bootstrap, server-IP + PC-identifier config persistence,
  three IPC handlers (`config:get`, `config:set`, `system:info`)
- `preload.js` — exposes `window.electron.*` via `contextBridge`

### Frontend (`src/`)

- **State** — Zustand stores for `auth`, `presence`, `socket` and `toast`
- **Services** — axios-based API service layer with automatic JWT header,
  session-expiry handling and offline toast
- **UI components** — `Button`, `Input`, `Select` (searchable), `Badge`,
  `Avatar`, `Table` (sortable + paginated + empty states), `SlideOver`, `Spinner`,
  `Toast`, `PageHeader`, `EmptyState`, `ConfirmDialog`, `PermissionGate`
- **Layout** — `Sidebar`, `Header`, `PresenceWidget`, `AppLayout`,
  `ProtectedRoute`
- **Pages**
  - `/login` — centered card with username/password, show-hide toggle,
    error states for invalid credentials and lockouts
  - `/dashboard` — quick-link cards (Phase-1 placeholder)
  - `/users` — table with avatar, role badge, status badge, online presence,
    add/edit via slide-over, deactivate + force-logout
  - `/employees` — table + slide-over with name, contact, role title,
    hire date, shift configuration
  - `/roles` — card grid (system roles show a lock icon and cannot be deleted)
  - `/roles/:id/permissions` — full permission matrix grouped by module,
    select-all per module, search, save

### Design system

All colors, fonts, radii and shadow are defined as Tailwind tokens in
`tailwind.config.js`:

```
bg #F5F6FA  surface #FFFFFF  surface-2 #F0F1F5
accent #F97316  accent-hover #EA6C0A  accent-light #FFF0E6
success #16A34A  warning #CA8A04  error #DC2626  (each + light variant)
ink #111827  ink-muted #6B7280  border #E5E7EB
shadow-card 0 1px 3px rgba(0,0,0,0.08)
font Inter
radius input 8px / card 12px
```

There are **no hardcoded colors** in any component — all styling uses these tokens.

### API contract

All responses follow the same envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "meta": { "page": 1, "limit": 20, "total": 42 } }

// error
{ "success": false, "error": { "code": "...", "message": "...", "details": null } }
```

Standard auth flow:

```
POST /api/auth/login        { username, password, pcIdentifier, hostname }
POST /api/auth/logout       Bearer <token>
POST /api/auth/refresh      Bearer <token>
GET  /api/auth/me           Bearer <token>
```

The login response shape is:

```jsonc
{
  "token": "...",
  "user": {
    "id": "...",
    "username": "...",
    "role": "Admin",
    "roleId": "...",
    "employeeId": null,
    "permissions": ["user.create", "user.edit", ...]
  }
}
```

### Security defaults

- Passwords hashed with bcrypt (rounds: 12)
- JWT signed with `JWT_SECRET`, default lifetime 8h
- 5 failed logins within 15 minutes triggers a temporary account lock
- `password_hash` is never returned by any API endpoint
- All timestamps are stored in UTC and displayed in Asia/Dubai
- Activity log records: `user.login`, `user.logout`, `user.force_logout`,
  `user.created`, `user.updated`, `user.deactivated`, `user.role_changed`,
  `employee.created`, `employee.updated`, `employee.deactivated`,
  `role.created`, `role.updated`, `role.permissions_updated`,
  `attendance.auto_check_in` (placeholder, to be expanded in Phase 11)

## Project structure

```
/
├── electron/
│   ├── main.js
│   ├── preload.js
│   └── ipc/                  # placeholder for future IPC modules
├── server/
│   ├── index.js
│   ├── middleware/           # auth, permissions, errors
│   ├── routes/               # auth, users, employees, roles, presence
│   ├── controllers/
│   ├── socket/
│   ├── utils/
│   └── db/
│       ├── postgres.js
│       ├── migrate.js
│       ├── seed.js
│       └── migrations/
├── src/
│   ├── components/
│   │   ├── ui/               # Button, Input, …
│   │   └── layout/           # Sidebar, Header, PresenceWidget
│   ├── pages/
│   │   ├── auth/             # LoginPage
│   │   └── users/            # Users / Employees / Roles
│   ├── hooks/
│   ├── store/                # Zustand
│   ├── services/             # http + per-domain services
│   ├── socket/
│   └── utils/
└── shared/
    ├── permissions.js
    └── errorCodes.js
```

## Roadmap

This phase implements the foundation. Subsequent phases will build on top of
the same database, error contract, design system and component library:

- Phase 2: POS terminal + invoicing
- Phase 3: Products, stock & suppliers
- Phase 4: Customers + balances
- ...
- Phase 11: Attendance module (the auto-check-in stub becomes real here)
