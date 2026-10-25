# Audit Fix Progress

**Date:** 25 October 2026 · **Branch:** `main` · **Full plan:** https://claude.ai/artifact/GHJHoJucC9xjWufhH5RCeM (private — open with the owner's account)

This report covers the work done against the nine `*_AUDIT.md` reports in this folder, what was verified, and what is still to do. Read **"Before you deploy"** first.

---

## 1. Before you deploy

1. **Rebuild Docker after pulling.** The shop runs in Docker (`bytecrapos-*`). Code changes only take effect after:
   ```bash
   docker compose up -d --build express-api nextjs
   ```
   The API applies the new database migrations on start (039, 040, 041). All three are additive (new columns, a new table, new permissions) and safe on the existing data.
2. **The checkout server tests have not run yet.** Docker Desktop was stopped when the last piece (checkout recovery) was finished, so `tests/integration/checkoutRecovery.test.js` and the full server suite were not run against that change. The web side of it was tested. Run the server suite (section 6) before deploying to the shop.
3. **Behaviour your staff will notice:**
   - Paying a supplier in cash needs the cash drawer **opened first** (it no longer opens itself).
   - A sale whose serial number is already under an active warranty is **blocked** instead of going through without a warranty.
   - Cashiers can still create warranties but **can no longer edit or void** them (new `warranty.edit` / `warranty.void`, Manager and Admin only).
   - After a dropped connection at checkout the screen says **"checking whether the sale went through…"** instead of "the sale was not completed".
   - The timeout **Retry** button only appears when retrying can't record something twice.

---

## 2. What was checked

All nine audits were read and the headline findings re-checked against the code (the reports cite line numbers from older commits).

| Audit | Result |
|---|---|
| Customer profile financial audit | Mostly fixed by `b14d912` before this work began |
| PO, cash drawer & payment audit | Confirmed — fixed in Phases 1–3 (see below), some items in Phase 4 |
| Purchase order, inventory & payment audit | Confirmed — fixed in Phases 1–3, some items in Phase 4 |
| Idempotency & duplicate operations audit | Confirmed — fixed in Phase 3 |
| Transaction atomicity audit | Confirmed — fixed in Phase 2 |
| Invoice financial integrity audit | Confirmed — report and restore items fixed; ledger items in Phase 4 |
| Warranty audit | Confirmed — main items fixed in Phases 1–2; per-unit warranties are a decision |
| User presence & logout audit | Confirmed — PC identity, tokens and names fixed in Phase 1; sockets/logout in Phase 5 |
| AI/ML feasibility audit | Not a defect list — no action needed now |

---

## 3. What was done

### Phase 0 — safety net (`e49ea61`)
- **Restore reported failures as success.** `pg_restore` exit code 1 (errors) counted as success, leaving a half-restored database. Restores now run as one transaction that stops at the first error; a failed restore leaves the current database unchanged.
- **Restore rehearsal.** A read-only dump of the live database was restored into a test database: all 86 tables and 1,738 rows matched exactly.
- **`scripts/reconcile.js`** — 14 read-only checks comparing stored balances with the records behind them (drawer, bank, customer balances, invoice and PO payments, stock vs movements, journal balance, ledger cash/bank vs treasury). Run before and after any change.
- **Disposable test database** for the integration suites (section 6).

### Phase 1 — wrong answers (`a83695b`)
1. Reports counted invoice discounts twice (AED 30 showed as 40).
2. The invoice page showed warranties from other invoices.
3. Editing a draft invoice removed its customer; editing a draft PO wiped its dates and notes.
4. Payments to a closed bank account were accepted (reversals may still use it).
5. Supplier bank payments didn't record which bank was used or the payment date, and reversals went to the current default bank under the original payer's name.
6. Two logins in the same second produced the same token.
7. The new-PO wizard said "payment recorded" when the payment had failed.
8. A fully discounted (AED 0) sale couldn't be completed.
9. Every browser identified itself by the server's name, so two PCs logged in as one user replaced each other's session.
10. The online-users list showed usernames instead of employee names.

### Phase 2 — all or nothing (`f5cb93d`)
- Direct stock adjustment: the stock move, journal, approval record and audit entry now commit together (before, stock could move with no record).
- Sale warranties are created inside the sale's confirmation and voided inside its cancellation.
- A partial return keeps warranty cover for the units the customer still has.
- Financial audit entries are written inside the transaction they record; a failed audit write cancels the operation.
- Return-request and warranty notifications go out only after the change is saved.
- Expense receipt files are deleted only after the expense is gone; a failed receipt upload no longer invites a duplicate expense.
- Supplier cash payments refuse a closed drawer.
- New `warranty.edit` / `warranty.void` permissions (migration 039 keeps them for custom roles that could create warranties).

### Phase 3 — safe retries (`5c65469` + this commit)
- **Commands:** customer collection, supplier payment, PO receipt, expense, cash adjustment, cash-to-bank transfer, bank deposit / withdrawal / transfer, and direct stock adjustment carry a request key. A repeated request (timeout, lost response, double click, second PC) returns the first result instead of doing the work again (migration 040, `server/utils/operations.js`). Same key with different details → 409.
- **Checkout:** each sale has a checkout ID, kept in the sale backup with its payment keys. A repeated draft returns the same invoice (migration 041). `GET /invoices/checkout/:checkoutId` reports what became of a sale whose response was lost, and both checkout screens use it to show the completed sale, "not completed — try again", or "can't tell yet — don't start it again".

### Other work in this push
- Analytics Overview: net profit bar chart with month picker, sales-by-category donut, bills & expenses streamgraph, daily invoices brush chart, app-shaped loading skeletons.
- Date-range fixes: net profit and sales timeline showed each day one day early; Peaks, sales timeline and category breakdown ignored the requested dates.
- `README.md` documentation update (HTTPS front door, environment variables, startup checks) — made outside this work, included as found.
- The three newer audit reports (AI/ML, idempotency, transaction atomicity).

---

## 4. How it was verified

- Every fix has a test that **fails on the old code and passes on the new** (checked by running the tests with the old files restored).
- Server: **477 tests pass** as of Phase 3 commands (the checkout piece not yet run — see section 1).
- Web: **172 tests pass**; TypeScript check clean.
- Reconciliation on a copy of live data was **unchanged** before and after every phase.
- The full server run occasionally dies with `Error: Channel closed` during the migration-upgrade test. That is the test runner, not a failing test; a rerun passes.

### Reconciliation baseline (copy of live data, 24 Oct 2026)
Two known differences, both explained — compare future runs against these:
1. **20 Sep:** the drawer closed at AED 1,230 and reopened at AED 100 — AED 1,130 left the drawer with no record (or it was test data).
2. **Ledger cash is AED 100 below the drawer** — the opening float, because opening a drawer posts no journal (Phase 4).

---

## 5. What is still to do

### Finish Phase 3
- Run the server suite against the checkout change (section 6), then deploy.
- Make request keys **required** once every screen sends them (they are optional today so older clients keep working).

### Phase 4 — make treasury, stock and the ledger agree (needs your accountant)
- Journal entries for manual cash/bank movements and transfers.
- Drawer close recomputes expected cash from its movements and posts cash over/short.
- Supplier payment reversals keep the original record (like customer payment voids).
- Warranty replacement posts its cost.
- Credit sales not counted as "collected"; debt aging from open invoices.
- VAT on split refunds and exchange differences.
- PO supplier-return button through the accounting-aware flow; block editing a paid draft PO.

### Phase 5 — logout and live presence
- Disconnect sockets on logout, deactivation and password change.
- The heartbeat must not revive a logged-out session.
- Count connections before marking a user offline; re-fetch presence after reconnect.
- Logout only reports "signed out" once the server confirms.
- Send presence events only to users allowed to see them.

### Decisions only you can make
- **FIFO costing** — sales currently use the latest purchase cost.
- **One shared drawer or one per till.**
- **Cheques** — build issued/cleared/bounced states, or hide cheque as a method.
- **Warranty per unit** (with serials) instead of per sale line.
- **HTTPS on the shop network** for logins (the TLS gateway exists; sockets aren't routed through it yet).

---

## 6. Running the tests on another machine

The integration suites create and drop their own databases. **Never point them at the shop database.** `tests/globalSetup.js` uses port 5432 when no port is set — on a machine with a local Postgres that is a real database.

Start a throwaway Postgres (data in memory, gone when stopped):
```bash
MSYS_NO_PATHCONV=1 docker run -d --name mahali-test-pg -e POSTGRES_PASSWORD=testpass -e TZ=Asia/Dubai -e PGTZ=Asia/Dubai -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data postgres:16-bookworm
```
Run the server suite against it:
```bash
INVOICE_TEST_PG_PORT=55432 INVOICE_TEST_PG_USER=postgres INVOICE_TEST_PG_PASSWORD=testpass npx vitest run
```
Run the web suite and type check:
```bash
npm --prefix web test && npx --prefix web tsc --noEmit -p web
```
Reconciliation (read-only) against any database:
```bash
PGHOST=… PGPORT=… PGUSER=… PGPASSWORD=… PGDATABASE=… node scripts/reconcile.js
```
