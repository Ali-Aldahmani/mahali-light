# Frontend migration inventory (Phase 1)

Source-verified inventory of the React/Vite SPA (`src/`) before the native
Next.js App Router cutover. Numbers below are exact file counts from `src/`
at the start of this migration.

## Summary

| Category | Count |
| --- | --- |
| Route-bearing pages (`src/pages/**`) | 100 files (incl. tabs/slide-overs) |
| Reusable UI components (`src/components/ui`) | 99 |
| Feature components (analytics/attendance/backup/bills/errors/notifications/pos/reports/returns/search/settings/setup/treasury) | 60 |
| Layout components (`src/components/layout`) | 5 |
| Services (`src/services`) | 51 |
| Zustand stores (`src/store`) | 21 |
| Hooks (`src/hooks`) | 3 |
| Utils (`src/utils`) | 2 |
| Files importing `react-router-dom` | 75 |
| Files touching `window.electron` | 13 |

## Route → Next.js route map

Full mapping from `src/App.jsx`'s `<Routes>` table to the native App Router
tree under `web/app/(dashboard)/**` (auth pages under `web/app/(auth)/**`).

| Vite route (React Router) | Next.js route | Permission gate |
| --- | --- | --- |
| `/setup` | `app/(auth)/setup/page.tsx` | — (SetupGate) |
| `/login` | `app/(auth)/login/page.tsx` | — |
| `/` | `app/page.tsx` → redirect | — |
| `/dashboard` | `app/(dashboard)/dashboard/page.tsx` | — |
| `/team` | `app/(dashboard)/team/page.tsx` | any: user.edit, employee.view |
| `/team/users/:id/permissions` | `app/(dashboard)/team/users/[id]/permissions/page.tsx` | `user.change_role` |
| `/users` (legacy) | `app/(dashboard)/users/page.tsx` → redirect `/team?tab=users` | — |
| `/employees` (legacy) | `app/(dashboard)/employees/page.tsx` → redirect `/team?tab=employees` | — |
| `/roles` (legacy) | `app/(dashboard)/roles/page.tsx` → redirect `/team?tab=roles` | — |
| `/roles/:id/permissions` | `app/(dashboard)/roles/[id]/permissions/page.tsx` | `user.change_role` |
| `/products` | `app/(dashboard)/products/page.tsx` | `product.view` |
| `/products/new` | `app/(dashboard)/products/new/page.tsx` | `product.create` |
| `/products/:id` | `app/(dashboard)/products/[id]/page.tsx` | `product.view` |
| `/categories` | `app/(dashboard)/categories/page.tsx` | `product.view` |
| `/attributes` | `app/(dashboard)/attributes/page.tsx` | `product.view` |
| `/inventory` | `app/(dashboard)/inventory/page.tsx` | `stock.view` |
| `/inventory/movements` | `app/(dashboard)/inventory/movements/page.tsx` | `stock.view` |
| `/inventory/counts/:id` | `app/(dashboard)/inventory/counts/[id]/page.tsx` | `stock.view` |
| `/suppliers` | `app/(dashboard)/suppliers/page.tsx` | `supplier.view` |
| `/suppliers/:id` | `app/(dashboard)/suppliers/[id]/page.tsx` | `supplier.view` |
| `/purchase-orders` | `app/(dashboard)/purchase-orders/page.tsx` | `supplier.view` |
| `/purchase-orders/new` | `app/(dashboard)/purchase-orders/new/page.tsx` | `supplier.purchase_order.create` |
| `/purchase-orders/:id` | `app/(dashboard)/purchase-orders/[id]/page.tsx` | `supplier.view` |
| `/customers` | `app/(dashboard)/customers/page.tsx` | `customer.view` |
| `/customers/outstanding` | `app/(dashboard)/customers/outstanding/page.tsx` | `customer.view_balance` |
| `/customers/:id` | `app/(dashboard)/customers/[id]/page.tsx` | `customer.view` |
| `/pos` | `app/(dashboard)/pos/page.tsx` | `invoice.create` |
| `/invoices` | `app/(dashboard)/invoices/page.tsx` | `invoice.view` |
| `/invoices/edit-requests` | `app/(dashboard)/invoices/edit-requests/page.tsx` | `invoice.edit_approve` |
| `/invoices/:id` | `app/(dashboard)/invoices/[id]/page.tsx` | `invoice.view` |
| `/warranties/lookup` | `app/(dashboard)/warranties/lookup/page.tsx` | `warranty.view` |
| `/warranties` | `app/(dashboard)/warranties/page.tsx` | `warranty.view` |
| `/warranties/:id` | `app/(dashboard)/warranties/[id]/page.tsx` | `warranty.view` |
| `/warranty-claims` | `app/(dashboard)/warranty-claims/page.tsx` | `warranty.view` |
| `/warranty-claims/:id` | `app/(dashboard)/warranty-claims/[id]/page.tsx` | `warranty.view` |
| `/returns` | `app/(dashboard)/returns/page.tsx` | `return.request` |
| `/returns/new` | `app/(dashboard)/returns/new/page.tsx` | `return.request` |
| `/returns/requests/:id` | `app/(dashboard)/returns/requests/[id]/page.tsx` | `return.request` |
| `/returns/orders/:id` | `app/(dashboard)/returns/orders/[id]/page.tsx` | `return.request` |
| `/settings/printers` | `app/(dashboard)/settings/printers/page.tsx` | `settings.view` |
| `/treasury` | `app/(dashboard)/treasury/page.tsx` | `cash.view` |
| `/attendance` | `app/(dashboard)/attendance/page.tsx` | `attendance.view_own` |
| `/attendance/leave-balances` | `app/(dashboard)/attendance/leave-balances/page.tsx` | `attendance.view_all` |
| `/attendance/holidays` | `app/(dashboard)/attendance/holidays/page.tsx` | `attendance.view_own` |
| `/expenses` | `app/(dashboard)/expenses/page.tsx` | `bills.view` |
| `/expenses/bills/:id` | `app/(dashboard)/expenses/bills/[id]/page.tsx` | `bills.view` |
| `/finance` | `app/(dashboard)/finance/page.tsx` | `finance.view_dashboard` |
| `/finance/journal` | `app/(dashboard)/finance/journal/page.tsx` | `finance.view_journal` |
| `/finance/journal/:id` | `app/(dashboard)/finance/journal/[id]/page.tsx` | `finance.view_journal` |
| `/finance/accounts` | `app/(dashboard)/finance/accounts/page.tsx` | `finance.view_journal` |
| `/finance/periods` | `app/(dashboard)/finance/periods/page.tsx` | `finance.view_journal` |
| `/reports` | `app/(dashboard)/reports/page.tsx` | — |
| `/reports/net-profit` | `app/(dashboard)/reports/net-profit/page.tsx` | — |
| `/reports/scheduled` | `app/(dashboard)/reports/scheduled/page.tsx` | `report.schedule` |
| `/reports/:category/:type` | `app/(dashboard)/reports/[category]/[type]/page.tsx` | — |
| `/analytics` | `app/(dashboard)/analytics/page.tsx` | `analytics.view` |
| `/approvals` | `app/(dashboard)/approvals/page.tsx` | — |
| `/settings` | `app/(dashboard)/settings/page.tsx` | — |
| `/settings/notifications` | `app/(dashboard)/settings/notifications/page.tsx` | — |
| `/settings/backup` | `app/(dashboard)/settings/backup/page.tsx` | `backup.view` |
| `/admin/bug-reports` | `app/(dashboard)/admin/bug-reports/page.tsx` | `bug.view_all` |
| `/admin/error-logs` | `app/(dashboard)/admin/error-logs/page.tsx` | `errors.view_all` |
| `*` (unmatched) | `app/not-found.tsx` → redirect `/dashboard` | — |

## Cross-cutting inventory

- **Layouts**: `AppLayout.jsx` (sidebar + header + socket bootstrap) → native
  `app/(dashboard)/layout.tsx`. `SetupGate.jsx` → `SetupGateClient` in the
  root layout. `ProtectedRoute.jsx` → `AuthGuard` + `RequirePermission`.
- **Contexts**: none (state is Zustand, not React Context) — ported as-is.
- **Stores** (`src/store/*.js`, 21 files): authStore, appSettingsStore,
  attendanceStore, backupStore, billStore, customerStore, financeStore,
  inventoryStore, invoiceStore, notificationStore, offlineStore, posStore,
  presenceStore, productStore, returnStore, socketStore, supplierStore,
  toastStore, treasuryStore, uiErrorStore, warrantyStore. All ported 1:1 to
  `web/store/*.ts` (framework-agnostic, no React Router dependency).
- **Services** (`src/services/*.js`, 51 files): every domain service
  (auth, products, variants, categories, attributes, stock, suppliers,
  purchase orders, customers, invoices, warranties, returns, treasury,
  attendance, leaves, bills, expenses, finance, analytics, reports,
  forecast/reorder, notifications, backup, error logs, bug reports, app
  settings, setup, search, print/PDF, hardware agent client) ported 1:1 to
  `web/services/*.ts`, funneling through the centralized `web/services/http.ts`
  Axios client (base URL, JWT header, PC identifier, request ID, structured
  error handling, 401/403 session/permission handling, offline detection).
- **Socket.io**: `src/store/socketStore.js` (JWT handshake, typed event
  emitters `onXxxEvent`) ported unchanged to `web/store/socketStore.ts` and
  wired into `app/(dashboard)/layout.tsx`.
- **Permission gate**: `src/components/ui/PermissionGate.jsx` ported to
  `web/components/ui/PermissionGate.tsx`; route-level equivalent is the new
  `web/components/guards/RequirePermission.tsx`.
- **Forms**: no external form library — plain controlled inputs
  (`Input`/`Select`/`Textarea` + local `useState` + inline validation).
  Preserved as-is.
- **Tables/Charts**: `components/ui/Table.jsx` (generic table) and
  `recharts`-based chart components under `components/analytics`,
  `components/ui/*Chart*` — ported unchanged (recharts is React-version
  agnostic, no SSR issues since all chart components are `'use client'`).
- **localStorage/sessionStorage**: auth token + user persisted via Zustand
  `persist` middleware to `sessionStorage` (`mahali-light.auth`) — preserved
  exactly (Phase 8: browser session semantics unchanged). `mahali.returnRoute`
  sessionStorage key used for post-login redirect after a 401. Sidebar
  collapsed state read/written to `localStorage` (`mahali.sidebarCollapsed`)
  replacing the old `window.electron.getConfig/setConfig` call (Electron no
  longer required for normal navigation — see `ELECTRON_EXIT_MATRIX.md`).
- **Electron dependencies** (13 files touching `window.electron`): guarded
  with optional chaining everywhere in the original code, so they degrade
  gracefully in a browser with no Electron preload script. See
  `ELECTRON_EXIT_MATRIX.md` for the full classification.
- **CSS/theme**: single Tailwind config + `src/index.css` → ported verbatim
  to `web/tailwind.config.js` / `web/app/globals.css`. No CSS-in-JS, no
  per-component stylesheets.

## Files importing `react-router-dom` (75) — disposition

All 75 call sites were converted during this migration:
`Link`→`next/link`, `useNavigate`→`next/navigation`'s `useRouter().push/replace`,
`useParams`→`next/navigation`'s `useParams`, `useLocation`→`usePathname`/
`useSearchParams`, `<Navigate replace>`→ server-component `redirect()` (route
table redirects) or `router.replace()` in a `useEffect` (guards). Zero
remaining `react-router-dom` imports in `web/`; the dependency was removed
from `web/package.json`.
