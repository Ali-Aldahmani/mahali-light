# Mahali / Bytecra POS — Production Readiness Audit

**Repo:** `D:\Projects\mahali-light` (branch `main`)
**Date:** 2026-09-20
**Scope:** full-stack security, correctness, money/inventory integrity, architecture, testing, CI/CD, observability.
**Method:** static analysis of source; `npm test` (vitest) executed; `npm run build` executed (root + web). No code changes made.

---

## 1. Methodology & Verification

Commands executed during audit — actual outcomes:

| Command | Result |
|---|---|
| `npm test` (root, vitest v4.1.7) | **105 passed, 6 failed, 1 skipped (16 files)**; see §12 |
| `npm run build` (root) | **FAILS**: `Missing script: "build"` |
| `npm install` + `npm run build` (web/) | **PASSES**: Next.js 15.5.25, compiled, types valid, 66 routes |
| grep `react-router-dom` in `web/` | not found (native App Router confirmed) |

Scope note: static analysis only, no live DB exercised; several peripheral services (report export internals, warranty/purchase-order deep paths, payroll) were pattern-checked rather than fully re-read.

---

## 2. Repository Overview

- `server/` — Express API (permanent core) + Socket.io, PostgreSQL 16, PM2/Docker deploys.
- `web/` — Next.js 15 App Router + TypeScript (installed deps: next 15.5.25, react 18.3.1, zustand, recharts, socket.io-client).
- `shared/` — errors, authz policy, permissions, websocket protocol.
- `hardware-agent/` — per-till localhost agent (printing).
- `backend-fastapi/` — future ML only (`GET /health`), opt-in `--profile ml`.
- `tests/` — vitest unit/contract/integration suites.
- Version drift: root/web `1.1.0` "Bytecra POS"; release workflows still template v1.2.0 "A1 Smart Light"; `drivelist` still declared in root deps though removed in `ebd3310`.

---

## 3. Architecture & Constraints

- Verified against required architecture: Express is the permanent API; Socket.io runs on the same Express host; `web/` uses native Next App Router (no `react-router-dom` anywhere in production code); PostgreSQL 16 permanent; migrations rebuild the schema (see §8).
- Two deployment modes: Electron till → `http(s)://serverIp:serverPort/api` (from `web/lib/config.ts`); browser → same-origin `/api`.
- Hardware Ergonomics: `hardware-agent/server.js` binds `127.0.0.1` only (rejects non-loopback), pairing token in `~/.bytecra-hardware-agent`, lists printers via `wmic`/`lpstat`, fetches PDF via `EXPRESS_URL` with a provided JWT. No business logic, no DB. Boundary respected.
- FastAPI README explicitly forbids POS duplication and the UI from pointing at it. Boundary respected.

---

## 4. Security

Strengths:
- JWT `requireAuth` reads `Authorization: Bearer` only, verifies session by `sha256` token hash (`server/middleware/auth.js`), rejects logged-out sessions, recomputes role + per-user overrides on every request (instant revocation).
- `JWT_SECRET` presence enforced at startup; rate limiters: login 20/15min/IP and global `/api` 500/min/IP (`server/index.js:264-265`).
- Helmet CSP `script-src 'none'`; CORS allowlist via `server/utils/corsOrigins.js` (loopback always allowed).
- Uploads: mimetype whitelist + sharp re-encode (`server/utils/upload.js`), directories gated by prior DB existence check (`server/utils/paths.js`).
- All `server/routes/*.js` are permission-gated (verified by grep over whole routes dir). PDF/receipt endpoints require `invoice.download` / `invoice.view` / `invoice.print`; backups require `backup.*`; finance exports require `finance.*` (`routes/print.js`, `routes/backup.js`, `routes/notifications.js`, `routes/finance.js`).
- `searchService` is permission-scoped and parameterized; `barcodeLookupService` is SSRF-safe (base URL env-trusted, barcode only as an encoded query param).
- Maintenance window middleware + `error.log` persistence with configurable stack capture.

Findings:

- **[HIGH, CONFIRMED] F10 — `/files` static mount is unauthenticated.**
  `server/index.js:273-280` mounts `express.static(getUploadsRoot())` at `/files` *before* the auth middleware, so **everything under `uploads/` is publicly readable by anyone who can reach the LAN port**: invoice/PO PDFs (customer names, phones, TRN — required for VAT), scheduled report files `uploads/reports/*`, expense/bill receipt attachments, and bug-report screenshots. Even though the current Next UI downloads through authenticated blob endpoints (`web/services/pdfService.ts`), the static mount still exposes every artifact with a guessable/leaked path.
  **Fix:** move `/files` behind `requireAuth` (and relevant permission) or replace the static mount with a permissioned controller that streams via `res.sendFile`; keep filenames non-guessable as defense-in-depth; exclude `/files` from the public paths of the maintenance banner.

- **[LOW, CONFIRMED] Info-disclosure leaks:** `server/controllers/printController.js` and `pdfService.js` return server-local `pdf_path`/`absPath` strings to clients (e.g. `D:\…\uploads\pdfs\invoices\<uuid>.pdf`), which reveals the on-disk layout. Prefer relative storage keys / direct streaming.

- **[LOW, POSSIBLE] F13 — setup race:** two concurrent `POST /api/setup/complete` can both pass `isSetupComplete()` (checked before the transaction, `setupService.js:17`) and both insert administrator users; the cash drawer is also opened *outside* the transaction (`setupService.js:124-141`) so a rollback leaves an orphan drawer session. First-run-only, LAN wizard, low blast radius; fix by re-checking (`SELECT … FOR UPDATE` on the app_settings row) inside the transaction and opening the drawer post-commit.

---

## 5. Authentication & Authorization

- Roles hierarchy Admin(100) > Manager(50) > Cashier/Warehouse(20) in `shared/authzPolicy.js`; defaults in `shared/permissions.js` (Manager l.141, Cashier l.172).
- Separation is deliberate and generally sound: Manager lacks `product.delete`, `supplier.delete`, `customer.delete`, `employee.delete`, `invoice.edit_direct`, `finance.close_period`, `backup.restore/configure`, `settings.edit`, `errors.*`.
- Gaps:
  - **[LOW/MEDIUM, CONFIRMED] F12 — permission edge cases.** `variantsController.update` accepts `costPrice` without requiring `product.view_cost` (write-without-read disclosure of margin). `usersController.forceLogout` (`server/controllers/usersController.js:311-361`) performs no target-role check; Manager holds `user.force_logout` and can therefore force-logout the Admin. Fix: gate `costPrice` on `view_cost`; restrict force-logout to Admin (or assert actor level > target level).
- Password policy minimum 6 chars; bcrypt rounds ≥ 10 (env-tunable); duplicate-username checks present. Notification preferences seeded per user.

---

## 6. Money & Inventory Integrity — CRITICAL FINDINGS

All confirmed from source.

- **[CRITICAL, CONFIRMED] F1 — Cancelling a confirmed invoice does not reverse the cash drawer / bank postings.**
  `invoiceService.cancelInvoice` (`server/services/invoiceService.js:664-831`) fully reverses stock (`return_in`, :694-722), customer credit (`GREATEST(0, credit_balance - credit)`, :725-742) and ledger entries (`reverseSaleEntries`, :747-753) — but **never reverses the `recordCashIn`/`recordBankIn` postings** made at confirm time (`invoiceService.js:432-455`). Consequence: for a cash/bank-paid invoice, after cancel the operational register (`cash_drawer_transactions`, `cash_sessions`, `bank_accounts.current_balance`) still counts the money while the ledger shows cancellation — drawer close totals and bank balance drift from the general ledger by the cancelled amount until manually reconciled. `closeDrawer` has no compensating adjustment for this case.
  **Fix:** inside the cancel transaction, mirror every payment method with a reversing treasury post (cash → refund out / bank → negative movement) or explicitly document the “keep drawer, adjust at close” policy and implement a reconciliation check in `closeDrawer`; add a regression test that cancel ⇒ drawer+ledger net zero.

- **[HIGH, CONFIRMED] F2 — Invoice payments: no idempotency key and no over-payment cap.**
  `invoicePaymentsController.create` (schema only enforces `amount > 0`) lets clients add unlimited payments to a **draft** invoice past `balance_due`, and repeated requests create duplicate payment rows (a double-click/retry on the POS creates duplicated cash entries that inflate the drawer). The invoice row is `FOR UPDATE`-locked, which serializes races but produces sequential duplicate rows rather than rejecting them.
  **Fix:** enforce `sum(existing)+amount ≤ balance_due` for drafts and confirmed invoices alike; support a server-side idempotency key (`X-Request-Id`), and route intentional overpayment into a customer-credit ledger entry rather than unlimited drawer cash.

- **[HIGH, CONFIRMED] F3 — Edit request can add a brand-new variant: stock deducted, no sale line.**
  `applyEditRequest` (`invoiceService.js:884-950`): when an added item has `oldQty = 0` the delta is positive and the code applies `applyStockMovement('sale')` **without INSERTing an `invoice_items` row** and without recalculating totals — inventory silently shrinks with no sale recorded.
  **Fix:** INSERT/UPDATE the `invoice_items` row for new variants (or reject adding new variants on confirmed invoices).

- **[HIGH, CONFIRMED] F4 — Editing a confirmed invoice adjusts stock + totals but not the ledger or treasury.**
  After an approved edit, `recalculateAndPersistTotals` (`invoiceService.js:966+`) updates `invoices` totals, but `postSaleEntry` was only issued at confirm. Journal revenue/COGS/VAT and the drawer/bank records therefore remain at the original amounts — a permanent three-way divergence (invoice vs journal vs treasury).
  **Fix:** after approved edits that change totals, post a balanced adjustment (rider) journal entry for the revenue/COGS/VAT deltas and a corresponding treasury correction; enforce that confirmed-invoice amounts can only decrease when the difference is refunded or credited.

- **[HIGH, CONFIRMED] F5 — Replacement invoice (return) posts a payment row but never records cash or sales entry.**
  `returnService.buildReplacementInvoice` (`returnService.js:1013-1164`) creates a **confirmed** replacement invoice, inserts a cash `invoice_payments` row for the price difference, but never calls `cashService.recordCashIn` nor `journalService.postSaleEntry` — drawer understated, and ledger revenue/COGS for the replacement sale are absent.
  **Fix:** run the replacement with the same posting path as a normal confirm (record treasury + sale/COGS entries) inside the same transaction.

- **[HIGH, CONFIRMED] F6 — Return/refund valuation ignores per-line discounts.**
  Refund amounts are computed from `unit_price × qty` (`returnService.js` buildRequestItems ~:326-350) with no allowance for the item’s `discount_amount`; discounted lines are over-refunded.
  **Fix:** value refunded lines at their effective net unit price (unit_price − per-line discount); validate `Σ refund ≤ paid-for net total`.

- **[MEDIUM, CONFIRMED] F9 — `customer_refund` can be approved/executed with an empty refund plan.**
  `approveAndExecute` (`returnService.js:773-866`) executes a refund with `refund_total = 0` and issues nothing when `refund_plan` is null/empty; `validateRefundPlan` (`returnService.js:97-132`) only checks the sum at creation.
  **Fix:** reject empty/zero-sum plans at approval time; require `Σ(plan) === approved refund_total`.

---

## 7. Concurrency

Strengths — `SELECT … FOR UPDATE` discipline is widespread: cash drawer sessions, bank transactions, purchase orders, warranties, stock movements, invoices, financial periods (journal), attendance check-in; invoice numbers are atomic via upsert sequence (`server/utils/docNumbers.js`); journal entry numbers likewise (`journalService.nextEntryNumber`).

Gaps:

- **[HIGH, LIKELY] F7 — Credit-limit check is not locked.**
  `customerService.assertWithinCreditLimit` reads `customers.credit_balance` without `FOR UPDATE`, and confirm does not lock the customer row (`invoiceService.js:399-415`) — two concurrent confirms can both pass the limit. Note `collectPayment` *does* lock (`customerService.js:43-63`), so the pattern is established; it is simply not applied here.
  **Fix:** `SELECT … FOR UPDATE` the customer row (or take an advisory lock) before asserting.

- **[HIGH, LIKELY] F8 — Committed-return quantity check is not locked.**
  `loadCommittedReturnQty` is a plain aggregate; two simultaneous return requests can both pass the “unreturned quantity” check and over-restock / over-refund.
  **Fix:** recompute committed quantities while holding `FOR UPDATE` on the invoice/sold items, or use an advisory lock keyed on invoice id.

- Known-good concurrency guard: `staleDraftInvoices` job only cancels drafts (no stock side-effects) — safe by design.

---

## 8. Data & Persistence

- Migrations: 24 numbered files `001_init.sql … 024_user_permissions.sql`; `server/db/migrate.js` runs each in its own transaction against one client and tracks applied files in `_migrations` — schema is rebuildable from scratch.
- Retention hygiene: `server/jobs/dbCleanup.js` nightly prunes `login_attempts` (>90d) and `user_sessions` (>30d, configurable); `staleDraftInvoices` hourly auto-cancels drafts older than 24h; scheduled reports archive to `uploads/reports`.
- Sequencing: `docNumbers.js` and `journalService` use atomic `ON CONFLICT DO UPDATE` upserts → no number gaps/races.
- Money stored as numeric; code rounds to 2dp (`Math.round(n*100)/100`) — acceptable for POS scale; a future migration to integer minor units would remove float edge cases.

---

## 9. API Design

- Consistent envelope `{success,error:{code,message,details,field}}`; typed `AppError` with `ERROR_CODES`; zod validation at controller boundaries; notFound + error handlers last in `server/index.js:341-342`.
- Rate limit split auth vs general; maintenance banner middleware; `429`/`409` semantics used correctly.
- Server-local path leaks in `pdf_path`/`absPath` responses (see §4).
- No contract-price/quote freeze beyond invoice `unit_price` snapshot on line items (edit requests reuse the stored price at edit time — consistent with F3/F4 caveats).

---

## 10. Frontend

- Next.js 15 App Router, 66 routes; `npm run build` passes with valid types. No `react-router-dom`.
- `web/services/http.ts`: axios bearer interceptor with `X-PC-Identifier`, `X-Request-Id`, `X-App-Version '1.1.0'`; no token-refresh loop (re-login required after 401).
- POS submit path (`web/app/(dashboard)/pos/page.tsx:221-244`) is create → addPayment → confirm; client guards double-submit with a local `submitting` flag only — retry after a network failure can submit the same cart twice (server-side F2 idempotency gap is the true protection).
- `web/store/posStore.ts` persists cart + offline queue (`mahali.pcIdentifier`, `mahali.posOfflineQueue`); the offline queue scaffolding exists but is not wired into the POS submit flow (network-failure replay not implemented).
- **[LOW, CONFIRMED-beta] F14 — PDF “open in new tab” without a token.** `web/services/printService.ts:79,104` uses `window.open(apiBase + /invoices/:id/pdf)`; the server accepts `Authorization` headers only (`auth.js:74-80`) and the browser tab cannot attach them → 401 artifact in browser mode. Electron flows pass the token via `ipc.downloadPdf`. Fix: issue a short-lived one-time download token (query param) for tab downloads, or standardise on blob download + object URL.
- Recharts is at the deprecated v2 branch (2.15.4) — plan a v3 bump.

---

## 11. Hardware Agent / ML Boundary

- `hardware-agent/server.js`: localhost-only (`403` for non-loopback), pairing-token auth, UUID-validated invoice ids, fetches PDFs from the Express API with the caller’s JWT, prints via OS default handler (`cmd start` on Windows, `lp` elsewhere). Appropriate minimal scope.
- `backend-fastapi/`: README enforces ML-only; exposes `GET /health`; UI/tills must not point at it; runs under `docker compose --profile ml`.

---

## 12. Testing

Executed: **`npm test` → 105 passed / 6 failed / 1 skipped**.

- Passing suites include unit (invoiceService 17, stockService 12), integration (auth 9), and contract tests (authz, concurrency.locks, security.escalation, corsOrigins, slice01, error.attendance, reports.registry) — a genuinely useful regression base.
- **6 failures are all contract tests referencing missing generated artifacts** under `docs/migration-contracts/`: `artifacts.test.js` (OPENAPI_CURRENT.yaml, API_INVENTORY.md) and `fixtures.analytics.test.js` (analytics-forecast fixture JSON). None of those files exist in the repo. Consequence: a fresh clone **cannot run the suite green**, which also makes CI red independently of the CI-script bugs (§13).
- `vitest.config.js` coverage includes only 3 files — coverage signal is minimal.
- no git-ignored generated docs in CI to regenerate them.

---

## 13. CI/CD — BROKEN

- `.github/workflows/build.yml` and `release.yml` run `npm run lint`, `npm run build`, `npm run build:electron`, `npm run build:electron:dir`, and set `VITE_APP_VERSION` — none of which exist in the current repo: root `package.json` scripts (l.12-27) contain only dev/build:server/test/…/pm2:*; the Vite/Electron builder was removed by the Next migration while the workflows were not updated.
- Verified at runtime: `npm run build` → `Missing script: "build"` (exit 1). CI is untrustworthy for both PR gates and releases.
- `web/package.json` has no lint/typecheck script (Next build “Skipping linting”), so frontend lint is covered nowhere.
- `release.yml` also has stale branding (A1 Smart Light / v1.2.0) and `magick` image conversion assumptions.
- **Fix plan:** rewrite both workflows: root `npm ci`; `npm test` (vitest); `npm --prefix web ci && npm --prefix web run build`; optionally add `eslint`/`tsc` scripts to `web/`; bump `version` + `X-App-Version` to one source of truth; regenerate/commit the migration-contract artifacts so `npm test` is green, or wire artifact generation into CI.

---

## 14. Observability & Maintenance

- Activity log (`logActivity`) on users/invoices/journal/expenses; invoice history rows; error log file + `/api/error-logs`; bug reports with screenshots.
- Socket events for stock, cancellations, presence; per-role rooms.
- Jobs: dbCleanup (nightly), staleDraftInvoices (hourly), scheduled reports, warranty expiry sweep; all daemon-backed and reschedule across DST.
- No structured logging/metrics exporter (no pino/logger lib, no Prometheus); relies on stdout + morgan. Recommended: add a JSON logger and an opt-in health/diagnostics endpoint with process metrics (memory, pool, queue lengths).

---

## 15. Findings Summary

| ID | Sev | Conf | Area | One-line impact | Ref |
|---|---|---|---|---|---|
| F1 | CRITICAL | High | Treasury/ledger | Cancel leaves drawer/bank overstated, ledger reversed | `invoiceService.js:664-831,432-455` |
| F2 | HIGH | High | Money | Duplicate/over-limit payments on draft+confirmed, no idempotency | `invoicePaymentsController.js` |
| F3 | HIGH | High | Inventory | Edit-request new variant deducts stock with no sale line | `invoiceService.js:884-950` |
| F4 | HIGH | High | Ledger/treasury | Confirmed-invoice edits change totals w/o journal/treasury update | `invoiceService.js:966+` |
| F5 | HIGH | High | Ledger/treasury | Replacement invoice posts payment but not cash/sale entries | `returnService.js:1013-1164` |
| F6 | HIGH | High | Refund | Refund values ignore line discounts (over-refund) | `returnService.js:~326-350` |
| F7 | HIGH | Likely | Concurrency | Credit-limit race (no lock on customer) | `invoiceService.js:399-415`, `customerService.js:273` |
| F8 | HIGH | Likely | Concurrency | Committed-return qty race (no lock) | `returnService.js loadCommittedReturnQty` |
| F9 | MED | High | Refund | Empty refund plan approves/executes refund $0 | `returnService.js:773-866,97-132` |
| F10 | HIGH | High | Security | `/files` serves all uploads unauthenticated | `server/index.js:273-280` |
| F11 | HIGH | High | CI/CD | Workflows call scripts that don’t exist; red CI, no releases | `.github/workflows/*.yml`, root `package.json` |
| F12 | LOW/MED | High | AuthZ | costPrice write w/o view_cost; Manager can force-logout Admin | `variantsController.js`, `usersController.js:311` |
| F13 | LOW | Possible | Setup | Concurrent setup double-admin; drawer opened outside txn | `setupService.js:16-141` |
| F14 | LOW | Confirmed | Frontend | PDF “open in new tab” 401 in browser mode | `web/services/printService.ts:79,104` |

Also: `npm test` fails out-of-the-box on missing `docs/migration-contracts/` artifacts (6 tests) — must be fixed to reach green CI; frontend recharts v2 deprecated.

---

## 16. Recommendations — Remediation Phases

Proposed execution order (each phase independently shippable):

- **Phase A (money integrity, highest priority):** F1 cancel-treasury reversal + close-drawer reconciliation check; F2 payment caps + idempotency key; F6 discount-aware refund valuation; F9 reject empty refund plans. Add regression tests for each (invoice cancel net-zero test, over-payment cap test, discounted-return test).
- **Phase B (POS edit/return flows):** F3 new-variant line insert or rejection; F4 adjustment journal/treasury rider on confirmed edits; F5 replacement invoice uses the standard confirm posting path. Wire client offline-queue replay and client/server cart dedup.
- **Phase C (concurrency hardening):** F7 lock customer before credit-limit assert; F8 lock/committed-count for returns; add concurrency contract tests for both.
- **Phase D (security hardening):** F10 put `/files` behind auth/permission and switch to permissioned streaming; keep non-guessable names; stop returning `pdf_path`/`absPath` to clients; F12 permission edge fixes; F13 setup race + drawer-outside-txn; F14 one-time PDF download token.
- **Phase E (deliverability):** F11 rewrite build+release workflows for Next.js; add `web/` lint+typecheck scripts; commit/regenerate migration-contract artifacts (green `npm test`); reconcile version strings (1.1.0 vs v1.2.0) into one source; drop stale `drivelist`; add JSON logging + process-metrics endpoint; document treasury vs ledger reconciliation runbook.