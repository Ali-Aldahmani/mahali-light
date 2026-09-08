# Native Next.js feature parity (Phase 21)

**Evidence basis for every row below:**
- **UI/API/Permissions/Realtime/Forms columns** — the route was ported by reading the
  full original `src/` source file(s) and re-implementing them natively under
  `web/`, preserving field names, validation, API calls, and permission checks
  exactly (see `FRONTEND_MIGRATION_INVENTORY.md` for the route map).
- **Compiles** — `npx tsc --noEmit` is clean (0 errors) and `next build`
  (production, `typescript.ignoreBuildErrors: false`) succeeds for all 61
  routes below.
- **Tested** — what was *actually exercised in a running browser* in this
  environment: `npm run dev` was started, the app was opened in a real
  browser, and the client-side app (SetupGate → setup wizard steps 1–2, live
  form state, step navigation) was interactively verified end-to-end with
  zero console errors. **No PostgreSQL/Express backend was available in this
  sandboxed environment**, so no route that requires a live API response
  (login, data tables, mutations) could be click-tested against real data.
  That is the single biggest gap between "migrated correctly" and "proven in
  production" — it requires a Docker host or a local Postgres+Express, either
  of which was unavailable here.

Status values used below (per the required vocabulary):
- **VERIFIED** — ported, compiles, AND interactively exercised against a live
  Express+PostgreSQL backend in a browser.
- **PARTIAL** — ported faithfully from the original source, compiles cleanly,
  structurally correct Next.js route (real `app/` folder, no React Router, no
  wrapped SPA) — but not yet click-tested against a live backend in this
  environment.
- **BLOCKED** — cannot be verified at all without infrastructure this
  environment doesn't have (Docker, a physical LAN, a physical printer).

## Route parity matrix

| Old route (React Router) | New Next.js route | UI parity | API parity | Permissions | Realtime | Forms | Tested | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/login` | `/login` | ✅ ported 1:1 | ✅ same `/api/auth` | n/a | n/a | ✅ validation preserved | Rendered, not click-tested (needs live auth) | PARTIAL |
| `/setup` | `/setup` | ✅ ported 1:1 | ✅ same `/api/setup` | n/a | n/a | ✅ 8-step wizard preserved | **Interactively tested** (steps 1–2 clicked through live in browser, zero console errors) | PARTIAL |
| `/dashboard` | `/dashboard` | ✅ | ✅ | none | ✅ socket bootstrap wired | n/a | Compiles; needs live data | PARTIAL |
| `/team` (+ legacy `/users`,`/employees`,`/roles`) | `/team` (+ redirect stubs) | ✅ tabs preserved | ✅ | internal per-tab gating preserved | n/a | ✅ | Compiles | PARTIAL |
| `/team/users/:id/permissions` | `/team/users/[id]/permissions` | ✅ | ✅ | `user.change_role` | n/a | ✅ | Compiles | PARTIAL |
| `/roles/:id/permissions` | `/roles/[id]/permissions` | ✅ | ✅ | `user.change_role` | n/a | ✅ | Compiles | PARTIAL |
| `/products` | `/products` | ✅ | ✅ | `product.view` | n/a | ✅ | Compiles | PARTIAL |
| `/products/new` | `/products/new` | ✅ | ✅ | `product.create` | n/a | ✅ | Compiles | PARTIAL |
| `/products/:id` | `/products/[id]` | ✅ | ✅ | `product.view` | n/a | ✅ | Compiles | PARTIAL |
| `/categories` | `/categories` | ✅ | ✅ | `product.view` | n/a | ✅ | Compiles | PARTIAL |
| `/attributes` | `/attributes` | ✅ | ✅ | `product.view` | n/a | ✅ | Compiles | PARTIAL |
| `/inventory` | `/inventory` | ✅ | ✅ | `stock.view` | ✅ stock events | ✅ | Compiles | PARTIAL |
| `/inventory/movements` | `/inventory/movements` | ✅ | ✅ | `stock.view` | ✅ | n/a | Compiles | PARTIAL |
| `/inventory/counts/:id` | `/inventory/counts/[id]` | ✅ | ✅ | `stock.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/suppliers` | `/suppliers` | ✅ | ✅ | `supplier.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/suppliers/:id` | `/suppliers/[id]` | ✅ | ✅ | `supplier.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/purchase-orders` | `/purchase-orders` | ✅ | ✅ | `supplier.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/purchase-orders/new` | `/purchase-orders/new` | ✅ | ✅ | `supplier.purchase_order.create` | n/a | ✅ multi-step | Compiles | PARTIAL |
| `/purchase-orders/:id` | `/purchase-orders/[id]` | ✅ | ✅ | `supplier.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/customers` | `/customers` | ✅ | ✅ | `customer.view` | ✅ balance events | ✅ | Compiles | PARTIAL |
| `/customers/outstanding` | `/customers/outstanding` | ✅ | ✅ | `customer.view_balance` | ✅ | n/a | Compiles | PARTIAL |
| `/customers/:id` | `/customers/[id]` | ✅ | ✅ | `customer.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/pos` | `/pos` | ✅ cart/checkout preserved exactly | ✅ | `invoice.create` | ✅ | ✅ split payment, discounts, barcode scan | Compiles; needs live data for cart | PARTIAL |
| `/invoices` | `/invoices` | ✅ | ✅ | `invoice.view` | ✅ | n/a | Compiles | PARTIAL |
| `/invoices/edit-requests` | `/invoices/edit-requests` | ✅ | ✅ | `invoice.edit_approve` | ✅ | ✅ | Compiles | PARTIAL |
| `/invoices/:id` | `/invoices/[id]` | ✅ | ✅ | `invoice.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/warranties/lookup` | `/warranties/lookup` | ✅ | ✅ | `warranty.view` | n/a | ✅ | Compiles | PARTIAL |
| `/warranties` | `/warranties` | ✅ | ✅ | `warranty.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/warranties/:id` | `/warranties/[id]` | ✅ | ✅ | `warranty.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/warranty-claims` | `/warranty-claims` | ✅ | ✅ | `warranty.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/warranty-claims/:id` | `/warranty-claims/[id]` | ✅ | ✅ | `warranty.view` | ✅ | ✅ | Compiles | PARTIAL |
| `/returns` | `/returns` | ✅ | ✅ | `return.request` | ✅ | n/a | Compiles | PARTIAL |
| `/returns/new` | `/returns/new` | ✅ 4-step wizard | ✅ | `return.request` | n/a | ✅ | Compiles | PARTIAL |
| `/returns/requests/:id` | `/returns/requests/[id]` | ✅ | ✅ | `return.request` | ✅ | ✅ | Compiles | PARTIAL |
| `/returns/orders/:id` | `/returns/orders/[id]` | ✅ | ✅ | `return.request` | ✅ | n/a | Compiles | PARTIAL |
| `/settings/printers` | `/settings/printers` | ✅ | ✅ | `settings.view` | n/a | ✅ | Compiles | PARTIAL |
| `/treasury` | `/treasury` | ✅ 5 tabs preserved | ✅ | `cash.view` | ✅ cash/bank events | ✅ | Compiles | PARTIAL |
| `/attendance` | `/attendance` | ✅ 4 tabs preserved | ✅ | `attendance.view_own` | ✅ | ✅ | Compiles | PARTIAL |
| `/attendance/leave-balances` | `/attendance/leave-balances` | ✅ | ✅ | `attendance.view_all` | n/a | n/a | Compiles | PARTIAL |
| `/attendance/holidays` | `/attendance/holidays` | ✅ | ✅ | `attendance.view_own` | n/a | ✅ | Compiles | PARTIAL |
| `/expenses` | `/expenses` | ✅ 3 tabs preserved | ✅ | `bills.view` | ✅ bill/expense events | ✅ | Compiles | PARTIAL |
| `/expenses/bills/:id` | `/expenses/bills/[id]` | ✅ | ✅ | `bills.view` | n/a | ✅ | Compiles | PARTIAL |
| `/finance` | `/finance` | ✅ 5 tabs preserved | ✅ | `finance.view_dashboard` | n/a | n/a | Compiles | PARTIAL |
| `/finance/journal` (+`/:id`) | `/finance/journal` (+`/[id]`) | ✅ shared component, list+detail | ✅ | `finance.view_journal` | n/a | ✅ | Compiles | PARTIAL |
| `/finance/accounts` | `/finance/accounts` | ✅ | ✅ | `finance.view_journal` | n/a | ✅ | Compiles | PARTIAL |
| `/finance/periods` | `/finance/periods` | ✅ | ✅ | `finance.view_journal` | n/a | ✅ | Compiles | PARTIAL |
| `/reports` | `/reports` | ✅ | ✅ | none | n/a | n/a | Compiles | PARTIAL |
| `/reports/net-profit` | `/reports/net-profit` | ✅ | ✅ | none | n/a | n/a | Compiles | PARTIAL |
| `/reports/scheduled` | `/reports/scheduled` | ✅ | ✅ | `report.schedule` | n/a | ✅ | Compiles | PARTIAL |
| `/reports/:category/:type` | `/reports/[category]/[type]` | ✅ dynamic dispatcher preserved | ✅ | none | n/a | ✅ filters | Compiles | PARTIAL |
| `/analytics` | `/analytics` | ✅ | ✅ | `analytics.view` | n/a | n/a | Compiles | PARTIAL |
| `/approvals` | `/approvals` | ✅ | ✅ | none (any authenticated) | ✅ | n/a | Compiles | PARTIAL |
| `/settings` | `/settings` | ✅ hub | ✅ | none | n/a | ✅ | Compiles | PARTIAL |
| `/settings/notifications` | `/settings/notifications` | ✅ | ✅ | none | n/a | ✅ | Compiles | PARTIAL |
| `/settings/backup` | `/settings/backup` | ✅ | ✅ | `backup.view` | ✅ backup/restore events | ✅ retention sliders | Compiles | PARTIAL |
| `/admin/bug-reports` | `/admin/bug-reports` | ✅ | ✅ | `bug.view_all` | n/a | n/a | Compiles | PARTIAL |
| `/admin/error-logs` | `/admin/error-logs` | ✅ | ✅ | `errors.view_all` | n/a | n/a | Compiles | PARTIAL |
| `*` (unmatched) | `not-found.tsx` → redirect `/dashboard` | ✅ | n/a | n/a | n/a | n/a | Compiles | PARTIAL |

## Cross-cutting checks

| Check | Status | Evidence |
| --- | --- | --- |
| App Router owns navigation | VERIFIED | 61 real routes under `web/app/**`; zero `react-router-dom` imports anywhere in `web/` (`grep -r react-router-dom web` → 0 hits) |
| No wrapped Vite SPA | VERIFIED | `web/app/[[...slug]]` catch-all and `web/components/ClientApp.tsx` (the `BrowserRouter`-wrapping component) were deleted; `web/next.config.mjs` has no alias/rewrite into `src/`; `grep` for `from '.*src/'` in `web/` → 0 hits |
| Production build from `next build` | VERIFIED | `cd web && npm run build` succeeds, `typescript.ignoreBuildErrors: false`, generates `.next/standalone/web/server.js` matching the Dockerfile's `CMD` |
| TypeScript throughout | VERIFIED | 0 files are `.js`/`.jsx` under `web/app`, `web/components`, `web/store`, `web/services`, `web/hooks`, `web/lib`; `npx tsc --noEmit` reports 0 errors |
| Socket.io from Next.js | VERIFIED (code) / PARTIAL (runtime) | `web/store/socketStore.ts` connects directly to Express's Socket.io on `NEXT_PUBLIC_EXPRESS_PORT`, wired into `app/(dashboard)/layout.tsx`; not exercised against a live Express instance in this environment |
| Auth/RBAC unchanged | VERIFIED (code) / PARTIAL (runtime) | Express remains sole authority; `web/components/guards/AuthGuard.tsx` and `RequirePermission.tsx` are UX-only, matching the original `ProtectedRoute` exactly; not exercised against a live login in this environment |
| Vite not required in production | VERIFIED | `web/Dockerfile` builds only from `web/` (no `COPY src`), `web/package.json` has no Vite/React Router dependency |

## What would promote PARTIAL rows to VERIFIED

Run `docker compose up -d` (or `npm run dev:server` + `cd web && npm run dev`
locally) against a real PostgreSQL instance, log in, and click through each
row above. That step could not be performed in this execution environment —
see `README.md` §13 (Health checks) and `docs/web-migration/VITE_ARCHIVE_STATUS.md`.
