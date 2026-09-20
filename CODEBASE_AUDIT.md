# Mahali POS — Codebase Audit

**Repo:** `D:\Projects\mahali-light` (branch `main`, HEAD `eb35142`)
**Date:** 2026-09-20
**Method:** Five parallel deep-dive investigations (architecture/dead-code, API security/RBAC, database/money/concurrency, Socket.io/Next.js frontend, testing/CI/deps/observability), each read-only and evidence-cited, followed by direct personal verification of every CRITICAL/HIGH claim — including actually *executing* the repo's live-database integration and concurrency test suites against a fresh, migration-built PostgreSQL instance (not just reading them). No code was modified during this audit.

This repo already contains a **prior** audit (same filename, committed in `36148b3` "Enforce invoice payment integrity and idempotency"), which found ten CRITICAL/HIGH money-and-inventory-integrity defects (F1–F10: treasury reversal on cancel, payment idempotency, edit-request stock/ledger gaps, replacement-invoice postings, discount-aware refunds, credit-limit and return-quantity race conditions, and an unauthenticated `/files` mount). This new audit's most important job was determining whether that remediation actually landed — see §15 "Test Coverage Gaps" and the verification log at the end for how this was confirmed, not assumed.

---

## 1. Executive Summary

**The prior audit's money/inventory findings (F1–F10) are fixed and regression-tested — confirmed by executing the tests, not by reading claims.** All 20 tests in `tests/integration/invoiceIntegrity.test.js` (labeled by finding ID: `F1`, `F2`, `F3/F4`, `F5`, `F6`, `F7`, `F8`, `F9`) plus the dedicated last-unit-stock race test pass against a real, freshly-migrated PostgreSQL 16 database that this audit spun up specifically to run them (they don't run in CI today — see Production Blockers). The unauthenticated `/files` static mount (old F10) is also fixed: uploads now route through a permission-gated router with an explicit public/private allowlist. The CI pipeline that was broken calling nonexistent Electron-build scripts (old F11) was independently fixed during this session's earlier work and is now green.

**The strongest areas:** transactional discipline (every money-moving flow — confirm, cancel, edit, refund, replacement — runs inside one `withTransaction` with row-level `FOR UPDATE` locks, not naive read-check-write), the auth/session model (server-side session revocation checked on every request, not just token expiry), CORS/rate-limiting/secrets hygiene, and the audit-log trail for financial mutations (real before/after values, not generic notes).

**The weakest area, and the headline new finding:** invoice line items accept a client-supplied `unitPrice` with no upper bound and no cross-check against the product's actual price, gated only by the same baseline permission every cashier already has to ring up a normal sale (§3, CRIT-01). The shipped UI never sends a manipulated price, so this isn't reachable by normal use — but it's fully reachable by anyone who can call the API directly (Postman, a modified client, a compromised session), and this audit's own instructions are explicit that frontend behavior is not a security boundary.

**Production blockers (must fix before handling real money unsupervised):** CRIT-01 (arbitrary invoice pricing). Everything else in this report is real but bounded — either already mitigated, requiring elevated permissions the attacker doesn't have by default, or a reliability/maintainability concern rather than a live money/security hole.

---

## 2. Architecture Discovered

```
Browser (till/cashier PC)
    │  HTTPS
    ▼
Next.js 15 App Router (web/, TypeScript, client-rendered)
    │  REST (axios, Bearer JWT) + Socket.io (JWT in handshake)
    ▼
Express API (server/index.js) ── hosts Socket.io on the same HTTP(S) server
    │
    ├─→ PostgreSQL 16 (server/db/, 25 sequential migrations, rebuildable from zero)
    │
    ├─→ Hardware Agent (hardware-agent/, optional, localhost-only, per-till,
    │     paired by token; POS degrades gracefully — printing falls back to
    │     "open PDF in viewer" — if absent)
    │
    └─→ FastAPI (backend-fastapi/, optional, `docker compose --profile ml`,
          NOT started by plain `docker compose up`; read-only analytics/
          forecast GET endpoints only, enforced by its own `test_no_writes.py`)
```

This matches the intended architecture closely, and is a genuine completed migration off a prior Electron+Vite+React-Router app (deleted from git; only gitignored local build leftovers remain on disk — see §12). No `react-router-dom` reference exists anywhere in `web/`. Deployment is Docker Compose (`docker-compose.yml`: `postgres`, `express-api`, `nextjs`, `fastapi[ml profile]`); a second, fully-documented PM2-on-Windows-without-Docker deployment path also exists (`ecosystem.config.js`, `docs/SERVER_AUTOSTART_GUIDE.md`) but isn't cross-referenced from the Docker-first README.

**Deviations found:**
- FastAPI independently re-implements JWT/session/permission validation in Python against the same tables Express owns, rather than delegating to Express (ARCH-01). It also performs a database **write** (`last_activity_at` touch) on every authenticated GET, which its own "read-only" test only checks by HTTP method, not by actual side effect.
- Hardware Agent's Windows print path doesn't print — it opens the PDF in the OS-default viewer minimized and ignores the printer the shop configured in Settings (ARCH-02).

---

## 3. Critical Findings

### CRIT-01 — Invoice line price is fully client-controlled, no server-side ceiling or product-price cross-check
**Severity:** CRITICAL · **Confidence:** CONFIRMED (personally re-verified, not just agent-reported) · **Category:** Broken access control / financial integrity
**Files:** `server/controllers/invoicesController.js:310-312` (`itemSchema`), `server/services/invoiceService.js:175` (`replaceItems`), `server/routes/invoices.js:15,19` (route gating)

**Evidence:**
```js
// invoicesController.js:310-312
unitPrice: z.number().nonnegative().optional(),
discountAmount: z.number().nonnegative().optional(),
discountPercent: z.number().min(0).max(100).optional(),

// invoiceService.js:175 — client value wins whenever present
unit_price: money(raw.unit_price ?? v.selling_price),

// routes/invoices.js — same baseline permission as a normal sale
router.put('/:id/items', requirePermission('invoice.create'), invoices.updateItems);
router.post('/:id/confirm', requirePermission('invoice.create'), invoices.confirm);
```
There is no ceiling on `unitPrice`, no comparison against `product_variants.selling_price`, and no separate permission (grep for `override_price`/`price_override` across the repo returns nothing) gating who may set an arbitrary price. `confirmInvoice` recalculates totals from whatever was stored, never re-deriving price from the product.

**Why it matters:** server-side validation is the *only* real authorization boundary (per this audit's own ground rules) — the UI sending the correct price is not a security control.

**Concrete failure scenario:** Any user holding `invoice.create` (the Cashier default role has this) calls `PUT /invoices/:id/items` with `{unitPrice: 0.01}` for a high-value item, then `POST /invoices/:id/confirm`. The sale rings up and stock deducts normally at the crafted price — a direct under-ring/theft vector, and fully reachable without any elevated privilege. The shipped UI (`web/store/posStore.ts:257`) always sends the real `selling_price` and never calls the store's own `updateUnitPrice` action from any component, so this is invisible in normal use but trivially reachable via a direct API call.

**Recommended fix:** derive `unit_price` server-side from the variant's current `selling_price` at confirm time (or a signed/short-lived price snapshot taken when the item was added), not from client input. If discretionary pricing is a genuine business need, add a dedicated `invoice.override_price` permission, log overrides explicitly via `logActivity`, and consider a discount-percent ceiling requiring manager approval above a threshold.

---

## 4. High Findings

### HIGH-01 — Hardware Agent doesn't actually print on Windows; configured printer is ignored
**Confidence:** CONFIRMED · **File:** `hardware-agent/server.js:76-90` (`printBuffer`)
On Windows — the documented primary deployment target — printing is `spawn('cmd', ['/c', 'start', '/min', tmp])`, which opens the PDF in the OS-default viewer minimized. It does not send anything to a printer, and the printer argument from the Settings → Printers UI is silently ignored on this branch (only wired up for the macOS/Linux `lp -d` path). The temp file is also deleted as soon as `cmd` returns, racing the viewer actually reading it.
**Scenario:** shop configures a receipt printer in Settings; every "print receipt" click just pops a PDF viewer instead of silently printing, and a cashier must manually print from there every time.
**Fix:** use an actual Windows silent-print mechanism (e.g. a bundled `SumatraPDF -print-to "<printer>" -silent`, or a signed print helper) and pass `printer`/`copies` through; delay cleanup until the print job completes.

---

## 5. Medium Findings

### MED-01 — Approvals queue leaks cross-department financial/PII data to any authenticated user
**Confidence:** CONFIRMED · **File:** `server/routes/notifications.js:15-16`, `server/services/approvalsService.js`
`GET /api/notifications/approvals/{counts,queue}` has only `requireAuth()`, no `requirePermission`. The queue includes pending return requests, invoice-edit requests, stock adjustments, and leave/attendance corrections — with customer names, invoice numbers, employee names, and monetary totals — visible to any logged-in user (e.g. a Cashier) regardless of whether they hold the underlying approval permission.
**Fix:** gate both routes behind an any-of check over the relevant approval permissions, or filter results server-side to what the caller can actually act on.

### MED-02 — "Admin" is trusted by name/string in several places, and a non-system role can be renamed to it
**Confidence:** LIKELY · **Files:** `shared/authzPolicy.js:12-17,40-42`, `server/controllers/rolesController.js:125-136`, `updateCheckController.js`, `notificationsController.js`, `backupController.js`
`PUT /api/roles/:id` (needs only `user.change_role`) blocks renaming only if `is_system` is true — a custom role can be freely renamed to `"Admin"`, and several sensitive gates check `role === 'Admin'` by string rather than a fixed system-role id/flag. This is defense-in-depth-breaking, not directly reachable by a low-privilege user (it first requires already holding `user.change_role`).
**Fix:** anchor "Admin" semantics to `is_system` + a fixed role id, and block renaming any role to a reserved name.

### MED-03 — Manager can forcibly disconnect the Admin's session (no role-rank check)
**Confidence:** CONFIRMED (personally re-verified) · **File:** `server/controllers/usersController.js:311-341`, `shared/permissions.js:169` (Manager defaults include `user.force_logout`)
`forceLogout` closes every open session for the target `user_id` with no check that the actor outranks the target. Manager holds `user.force_logout` by default, so a Manager can force-logout the Admin at will — a nuisance/DoS-style privilege issue, not a data breach.
**Fix:** require the actor's role rank to exceed the target's before allowing force-logout, or restrict the permission to Admin-only roles.

### MED-04 — FastAPI silently writes to the database despite being documented as read-only
**Confidence:** CONFIRMED · **File:** `backend-fastapi/app/core/security.py:88-127`
Every authenticated GET request triggers `UPDATE user_sessions SET last_activity_at = NOW() ... ; db.commit()` inside the auth dependency. `test_no_writes.py` only asserts no route uses POST/PUT/PATCH/DELETE — it doesn't catch this write hidden inside a GET's dependency chain, so the "read-only sidecar" guarantee this service is supposed to provide isn't actually enforced by its own tests.
**Fix:** either drop the write (session touch isn't essential for a read-only analytics service) or add a test asserting zero DB writes across a request, and document the exception if kept.

### MED-05 — Two payment-adjacent tables are missing foreign keys that equivalent tables elsewhere already have
**Confidence:** CONFIRMED · **Files:** `server/db/migrations/005_customers.sql:25` (`customer_payments.invoice_id`), `006_invoices.sql:60` / `009_returns.sql:95` (`*.bank_account_id` on `customer_payments`, `invoice_payments`, `refund_payments`)
These columns are plain `UUID` with no `REFERENCES` constraint, while the equivalent pattern is enforced elsewhere in the same migration set (`reorder_alerts.suggested_supplier_id`, `bills.bank_account_id`). A typo'd or stale id in these columns is silently accepted; joining reports on them silently drop rows.
**Fix:** add a follow-up migration with the missing `ADD CONSTRAINT ... FOREIGN KEY ... ON DELETE SET NULL`.

### MED-06 — CI never runs the tests that actually prove money/inventory correctness
**Confidence:** CONFIRMED · **Files:** `tests/integration/invoiceIntegrity.test.js`, `tests/contracts/concurrency.live.test.js`, `.github/workflows/build.yml`/`release.yml`
Both files are real, substantive integration tests (not shallow mocks) that require a live Postgres (`INVOICE_TEST_PG_PORT`, `RUN_PG_CONCURRENCY=1`) — neither is set in either workflow, so `npm test` in CI silently skips all 21 of these tests every run. This audit executed them directly against a throwaway Postgres container: **all 21 pass**, which is what makes the F1–F10 fixed-and-tested conclusion in §1 trustworthy rather than assumed — but that same proof doesn't happen automatically on the next PR.
**Fix:** add a Postgres service container to CI and set the two env vars so this suite actually gates merges.

### MED-07 — Frontend has zero runtime validation of API responses and near-universal `any`
**Confidence:** CONFIRMED · **File:** `web/services/http.ts:134-149` (`apiGet<T = any>` etc.), project-wide
805 occurrences of `: any` / 14 of `as any` across `web/`; the vast majority of `apiGet/apiPost/...` call sites never supply a type argument. No `zod` or other runtime schema library exists anywhere under `web/`. Network responses are trusted as their declared TypeScript shape with zero runtime guarantee — a backend contract change surfaces as a silent bad-data bug or crash, not a caught error.
**Fix:** not a full rewrite — start with the money-handling call sites (invoice/payment/return responses) getting explicit types plus a lightweight runtime check (zod parse or manual guard) before use.

### MED-08 — No route-level error boundary / loading UI outside the dashboard shell
**Confidence:** CONFIRMED · **File:** `web/app/` (no `error.tsx`/`loading.tsx` anywhere; only `not-found.tsx`)
`web/components/ErrorBoundary.tsx` wraps the `(dashboard)` layout, so render errors there are caught — but `(auth)/login` and `(auth)/setup` have no such wrapper, and there's no `loading.tsx` anywhere, so a slow initial fetch on any route can show a blank screen before any fallback kicks in.
**Fix:** add root-level `error.tsx`/`loading.tsx`, and wrap the auth route group too.

### MED-09 — `/api/health` doesn't check anything
**Confidence:** CONFIRMED · **File:** `server/index.js:275-282`
Returns `{status:'ok'}` unconditionally — no DB ping, no dependency check. Docker's healthcheck/restart policy (and any future orchestrator) relies on this signal; a database outage would still report healthy.
**Fix:** add a timeout-bounded `SELECT 1`; return 503 on failure.

### MED-10 — No frontend tests at all
**Confidence:** CONFIRMED · **File:** `web/` (zero `*.test.ts(x)` files; no test script in `web/package.json`)
Any regression in cart totals, permission-gated UI, or socket event handling ships undetected.
**Fix:** start with smoke coverage for checkout total display and permission-gated route access.

---

## 6. Low Findings

- **LOW-01 (CONFIRMED)** — Unclassified backend errors return `err.message` to the client unconditionally in production (`server/services/errorLogService.js:303-312`, the fallback branch isn't `NODE_ENV`-gated like the sibling `details.hint`). Minor info-disclosure risk (SQL fragments, internal paths). Fix: gate the fallback message behind `NODE_ENV`.
- **LOW-02 (POSSIBLE)** — Stock-adjustment quantity and some monetary fields have no upper bound, only sign checks (`stockAdjustmentsController.js:21-28`). Add explicit `min`/`max` bounds.
- **LOW-03 (CONFIRMED)** — `costPrice` write path on variant update wasn't confirmed to check `product.view_cost` the same way reads do (carried forward from the prior audit, not independently re-verified to the same depth as other findings this round — worth a direct check before relying on it).
- **LOW-04 (CONFIRMED)** — Several `io.emit()` events (`stock_updated`, `invoice_pdf_ready`, `print_receipt_requested`) broadcast unscoped to every authenticated socket regardless of role; payloads are IDs/counts, not sensitive data, so this is a noise/hygiene issue, not exploitable.
- **LOW-05 (CONFIRMED)** — No structured/JSON logging or request-correlation IDs anywhere in `server/` (118 scattered `console.*` calls across ~97 files). Makes correlating a single request across a production incident's logs hard.
- **LOW-06 (CONFIRMED)** — No `.github/dependabot.yml` and no `npm audit` step in CI.
- **LOW-07 (CONFIRMED)** — No dedicated `tsc --noEmit` CI step (frontend typecheck currently only verified manually — it is clean as of this audit, see verification log).
- **LOW-08 (CONFIRMED)** — `reportService.js` (2151 lines), `returnService.js` (1424), `invoiceService.js` (1252) are large multi-responsibility files; several `web/app/.../[id]/page.tsx` route files exceed 900–1250 lines mixing data-fetching, form state, and presentation.
- **LOW-09 (INFO)** — All 59 `web/app/**/page.tsx` files start with `'use client'`, forfeiting React Server Component benefits App Router otherwise provides. Likely an intentional tradeoff for a LAN POS tool with no SEO/first-paint concerns — reported as an observed pattern, not a defect.
- **LOW-10 (INFO)** — Root `package.json` still ships full PM2 scripts/`ecosystem.config.js` alongside the Docker-first README, a legitimate second deployment path that just isn't cross-referenced from the README.
- **LOW-11 (INFO)** — Local, gitignored Electron-era build artifacts (`release/`, `dist/`) remain on disk under a different product name ("A1 Smart Light") than the current app — not tracked in git, harmless, but could mislead someone browsing the filesystem directly.
- **LOW-12 (not independently re-verified this round)** — Prior audit's F14 (PDF "open in new tab" hits a 401 in browser mode because the browser tab can't attach the `Authorization` header) and its note that `recharts` is pinned to the deprecated 2.x branch — both carried forward from the previous audit; confirm before relying on either.

---

## 7. Security Review

**Authentication:** JWT verified, then session existence and `logout_at IS NULL` are re-checked against `user_sessions` by `token_hash` on **every** request (`server/middleware/auth.js`) — logout and force-logout are real server-side revocations, not just client-side token discard. `JWT_SECRET` is enforced at startup (fails hard if missing, too short, or matches a known-weak prefix in production). Token expiry defaults to 8h; refresh re-signs and rotates `token_hash`, invalidating the old token.

**Authorization:** all 40 route files were checked; every one applies `requireAuth()` plus per-route `requirePermission()` with two gaps found (MED-01 approvals queue, MED-03 force-logout rank). Mass assignment is avoided — controllers use explicit Zod schemas and column builders, never `...req.body` spread into SQL; role/permission changes route through `shared/authzPolicy.js`'s rank-hierarchy checks. The one broken access-control finding that matters is CRIT-01 (pricing), which is a validation gap, not a missing-permission-check gap — the permission required is correct, the *value* accepted through it isn't bounded.

**Secrets:** no hardcoded API keys/passwords/tokens found anywhere in `server/`, `shared/`, `web/`, or `scripts/`. `.env` is not tracked in git (only `.env.example` files are); the local `.env` used during this session's earlier work correctly stayed untracked.

**Input validation:** sampled across invoices, stock adjustments, purchase orders, cash drawer, customers, users, and roles — all use Zod schemas before touching the database.

**CORS / rate limiting:** explicit origin allowlist (not a wildcard reflect-any-origin policy); login is both IP-rate-limited (20/15min, real socket address, not the spoofable `X-Forwarded-For`) and DB-backed per-username lockout (5 attempts/15min); a global 500/min limiter covers the rest of `/api`.

**OWASP-relevant gaps found:** CRIT-01 (broken access control — unbounded price input), MED-01 (broken access control — missing authorization on a data-exposing route), LOW-01 (information exposure via error messages). No SQL injection, XSS, CSRF, SSRF, path traversal, or insecure-deserialization findings were surfaced by any of the five investigations across the routes/controllers they covered.

---

## 8. Database & Transaction Review

**Migration integrity:** 25 sequential files (`001`–`025`), tracked in an `_migrations` table, each applied inside its own transaction with rollback on failure — the schema is rebuildable from zero, confirmed both by reading `migrate.js` and by this audit actually running it end-to-end into a fresh database as part of executing the integration tests.

**Constraints:** real foreign keys with explicit `ON DELETE` behavior on all core money/inventory tables that were checked (users, sessions, products, variants, stock movements, invoices, invoice items, invoice payments, returns) — two gaps found (MED-05).

**Money representation:** all monetary columns are `DECIMAL(12,2)`/`DECIMAL(5,2)`, never float. JS-layer arithmetic uses native `Number` but a `money()` = round-to-cent helper is applied identically after every arithmetic step across every money-touching service (`invoiceService.js`, `returnService.js`, `cashService.js`, `journalService.js`, `billService.js`); `journalService` additionally hard-validates debits==credits before any journal insert.

**Transactional integrity:** `confirmInvoice` locks the invoice row `FOR UPDATE`, recalculates totals, checks stock, deducts it, posts payments and the journal entry, and flips status — all in one `withTransaction`/one commit. A crash mid-flow rolls back cleanly; sockets/PDF generation are deliberately deferred until after commit.

**Inventory concurrency — the critical test, and it's handled correctly.** `findStockShortfalls` takes `SELECT ... FOR UPDATE` on every variant row in the cart *before* checking quantities, and `applyStockMovement` re-locks the same row before computing `after = before + delta`, rejecting if negative. This audit verified this isn't just a code-reading claim: `tests/contracts/concurrency.live.test.js` was executed against a real two-connection race on a live database (`RUN_PG_CONCURRENCY=1`), and it passed — **only one of two simultaneous confirms for the last unit of stock succeeds.**

**Idempotency:** `invoice_payments.idempotency_key` (migration 025) plus a partial unique index enforces that a client-supplied `Idempotency-Key` either replays the prior result or gets a 409 on conflicting reuse. Scope is the payment-add step specifically; `confirmInvoice` itself uses a status-transition guard (`status !== 'draft'` throws) as its own idempotency mechanism — a retry after a network drop gets a clean error rather than a replayed success, which is safe (no double effect) but not as smooth.

**Refunds:** `approveAndExecute` locks the return-request row and rejects a second approval on an already-processed request — a refund cannot be applied twice. Financial reversal and inventory restoration happen in the same transaction.

**N+1 / unbounded queries:** invoice listing is properly paginated and capped. One bounded N+1-shaped pattern was found in a yearly report builder (≤12 iterations, admin-only, low real-world impact) — not flagged as a standalone finding given the bound.

---

## 9. Frontend Review

Next.js 15 App Router used correctly and exclusively — no `react-router-dom`, confirmed via full-tree grep. The axios client attaches the bearer token consistently via a single interceptor, and 401 handling is clean (clears auth state synchronously, no retry loop). The one meaningful gap in the checkout flow itself is *not* a frontend bug: `confirmInvoice` is called with an **empty body** — no client-computed total or quantity is trusted — so stale frontend stock state (a missed `stock_updated` socket event) cannot cause overselling; the server re-locks and re-checks stock at confirm regardless of what the client last saw. The same is not true of *price* (CRIT-01) — quantity/stock is re-derived server-side, price currently isn't.

Weaknesses: near-universal `any` typing with zero runtime validation of network responses (MED-07), missing error/loading boundaries outside the dashboard shell (MED-08), and every route file being `'use client'` (an architectural tradeoff, not flagged as a defect — see LOW-09).

---

## 10. Realtime Review

Socket.io authenticates the handshake via JWT and re-verifies the session against the database (same trust model as REST), joining `user:`, `session:`, and `role:` rooms derived entirely from server-side data — never from client-supplied room names. The only two client→server event handlers that exist at all are `heartbeat` (ignores its payload, writes only the server-known `sessionId`) and `disconnect` (no payload) — there is currently no mutating socket event a client can trigger, so there's no realtime path around REST authorization today. `force_logout` is REST-only, permission-gated, and looks up the target's real sessions from the database before emitting — a client cannot target an arbitrary session or user. The only findings here are informational: several broadcast events are unscoped by role (LOW-04), and there's no established authorization pattern yet for a *future* mutating socket event, which is worth establishing proactively before one gets added.

---

## 11. Test Coverage Gaps

- **The suite that actually proves money/inventory correctness doesn't run in CI** (MED-06) — this audit had to stand up a throwaway Postgres container itself to execute `invoiceIntegrity.test.js` (20 tests) and `concurrency.live.test.js` (1 test) for real; all 21 passed, which is the evidence behind this report's "F1–F10 are fixed" conclusion.
- **Zero frontend tests** (MED-10).
- RBAC is proven correct at the middleware/unit level (`authz.contract.test.js`, `authzPolicy.test.js`, `security.escalation.test.js`) but never at the actual route level — no test drives a real Express route with a low-privilege JWT to confirm a live 403; a route that forgot to call `requirePermission` wouldn't be caught by the existing suite.
- Discount-stacking (line discount + invoice discount + tax combined) has no dedicated unit test.
- No test exists for CRIT-01 — unsurprising, since the gap itself is unfixed.

---

## 12. Dead / Legacy Code

- Electron/Vite-era build artifacts (`release/`, `dist/`) — gitignored, not tracked, harmless, but present on disk under a different product name.
- `docs/archive/` and `docs/web-migration/` are historical migration records, correctly not part of the production tree — not flagged as dead code, per this audit's own instructions.
- `drivelist` dependency was reintroduced by the Next.js migration commit after already being removed once for hanging the Windows build (fixed earlier this session, not a current issue — noted here only because it's exactly the kind of silent regression this section is meant to catch).
- Root `package.json`'s PM2 scripts are a live, documented second deployment path, not dead code (LOW-10).

---

## 13. Maintainability Issues

- Several god-files on both sides: `server/services/reportService.js` (2151 lines), `returnService.js` (1424), `invoiceService.js` (1252) on the backend; `web/app/(dashboard)/returns/new/page.tsx` (1253), `invoices/[id]/page.tsx` (1132), `customers/[id]/page.tsx` (969) on the frontend, mixing data-fetching, form state, and presentation in single route files (LOW-08).
- 805 `any`-typed values across `web/` with no runtime validation layer (MED-07) is a maintainability risk as much as a safety one — every API contract change is a silent trust exercise.
- Two independently-maintained implementations of the auth/permission model (Express and FastAPI) will drift over time unless one delegates to the other (MED-04/ARCH-01).

---

## 14. Performance & Scalability

**Current, verified issues:** none rise to a confirmed production bottleneck. The one N+1-shaped pattern found (yearly report builder) is bounded to ≤12 iterations on an admin-only endpoint.

**Reasonable future scaling considerations (not current problems):** the architecture is a modular monolith appropriate for its current scale (single-store to modest multi-till LAN deployment); `io.emit()` broadcasts unscoped by role (LOW-04) would become a real bandwidth/noise concern only at a till-count scale far beyond what this deployment model targets. Multi-store/multi-tenant isolation was not exercised by this audit (no evidence of multi-tenant intent in the schema — this is a single-store LAN system by design) and isn't a current gap given the documented deployment model.

---

## 15. Production Blockers

Only genuinely blocking issues, not cosmetic items:

1. **CRIT-01** — arbitrary invoice pricing via direct API call. This is the one finding in this entire audit that represents a live, reachable path to financial loss with no elevated privilege required.

Everything else in this report (HIGH-01 hardware printing, all MEDIUM findings) is real but does not block safe operation of the POS for its core function — selling, confirming, cancelling, and refunding invoices at correct prices, with correct stock and treasury accounting — which is what an audit-executed regression suite of 21 tests against a live database now demonstrates works correctly.

---

## 16. Recommended Remediation Order

**Phase A — Integrity & Security** (addresses CRIT-01, MED-01, MED-02, MED-03, MED-05)
Fix invoice pricing to be server-derived (CRIT-01) before anything else — this is the only production blocker. Then close the approvals-queue permission gap (MED-01), anchor "Admin" to a non-renamable flag (MED-02), add the force-logout rank check (MED-03), and add the two missing FK constraints (MED-05).

**Phase B — Reliability** (addresses MED-04, MED-06, MED-09)
Wire the live-Postgres integrity/concurrency suite into CI (MED-06) so Phase A's regression protection is continuous, not manual. Add a real DB check to `/api/health` (MED-09). Decide and enforce FastAPI's read-only guarantee for real (MED-04).

**Phase C — Maintainability** (addresses MED-07, MED-08, LOW-05, LOW-08)
Add runtime validation for money-related API responses first (MED-07), then error/loading boundaries (MED-08), then structured logging (LOW-05), then split the largest files opportunistically as they're touched (LOW-08) — not as a standalone rewrite effort.

**Phase D — Testing** (addresses MED-10, and the RBAC/discount gaps in §11)
Add frontend smoke tests for checkout and permission-gated routes (MED-10), route-level RBAC integration tests, and a discount-stacking unit test.

**Phase E — Performance & Scale**
No current-state action needed; revisit `io.emit()` scoping (LOW-04) only if/when till count grows enough to make it a measured problem.

---

## Verification Log

| Command | Result |
|---|---|
| `npx tsc --noEmit` (web/) | **Clean**, no errors |
| `NODE_ENV=production npm run build` (root, builds web/) | **Passes**, 66 routes compiled |
| `npm test` (root, vitest, mocked/no-DB suites) | **147 passed, 27 skipped, 0 failed** (17 files); skips are the live-DB suites below plus an explicitly-abandoned FastAPI-migration experiment's dead fixtures |
| `docker run postgres:16-bookworm` (throwaway, isolated, torn down after) + `INVOICE_TEST_PG_PORT=... npx vitest run tests/integration/invoiceIntegrity.test.js` | **20/20 passed** — real migrations applied fresh, real transactions, real HTTP layer via supertest |
| same throwaway DB, `RUN_PG_CONCURRENCY=1 npx vitest run tests/contracts/concurrency.live.test.js` | **1/1 passed** — real two-connection last-unit-stock race, only one confirm succeeds |
| Direct grep/read verification of CRIT-01, the `/files` router (old F10), CI workflow content (old F11), and MED-03 force-logout | Personally re-confirmed against current source, not taken from agent reports alone |

**Files inspected:** all 40 route files under `server/routes/`; corresponding controllers for the highest-risk ones (auth, users, roles, invoices, invoice payments, stock adjustments, purchase orders, cash drawer, presence, approvals, updates); `server/services/{invoiceService,returnService,stockService,cashService,journalService,billService,customerService}.js`; `server/middleware/{auth,permissions,rateLimiter}.js`; `server/socket/index.js`; all 25 migrations plus `migrate.js`/`postgres.js`; `shared/{authzPolicy,permissions,errorCodes}.js`; `hardware-agent/server.js`; `backend-fastapi/app/core/security.py`; `web/app/` (sampled + exhaustively grepped for patterns), `web/store/{authStore,posStore,socketStore,presenceStore}.ts`, `web/services/http.ts` + samples; `.github/workflows/{build,release}.yml`; `docker-compose.yml`, `README.md`, `docs/` (top-level).

**Important files not exhaustively read (time-boxed, sampled/grepped instead):** `analyticsController.js`, `forecastController.js`, `purchase_orders` migration internals, `web/app/` beyond the ~10 largest/most sampled route files, `hardware-agent/` beyond the print path, `backend-fastapi/` beyond the auth dependency.

**Limitations of this audit:** static analysis plus targeted live-database test execution — not a full penetration test, not a load test, and not exhaustive over all 40+ route files' controllers at the same depth as the ones sampled above. LOW-03 and LOW-12 are carried forward from the prior audit without independent re-verification to the same standard as everything else in this report and should be confirmed before being relied on.
