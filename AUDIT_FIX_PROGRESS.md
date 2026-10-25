# Audit Fix Progress

**Updated:** 25 October 2026 · **Branch:** `main` · **Full plan:** https://claude.ai/artifact/GHJHoJucC9xjWufhH5RCeM (private — open with the owner's account)

This report covers the work done against the nine `*_AUDIT.md` reports in this folder, what was verified, and what is still to do. Read **"Before you deploy"** first.

**Status:** Phases 0–5 are done in code and tested. What's left is listed in section 5: mostly decisions for you and your accountant, not code.

---

## 1. Before you deploy

1. **Back up first, then rebuild Docker.** The shop runs in Docker (`bytecrapos-*`). Code changes only take effect after:
   ```bash
   docker compose up -d --build express-api nextjs
   ```
   The API applies the new migrations on start: 039, 040 and 041 (earlier phases), **042** (purchase-order comments) and **043** (two new accounts, supplier payment reversal columns). All are additive (new columns, tables, accounts, permissions) and safe on existing data. The API refuses to migrate without a successful pre-migration backup. That is on purpose.
2. **Run the reconciliation before and after the deploy** (section 6) and compare with the baseline in section 4. A new difference means stop and investigate.
3. **Reload every till's browser after the deploy.** Money and stock actions now *require* a request key. A page loaded before the update doesn't send one and gets "This screen is out of date. Reload the page and try again."
4. **Things staff will notice:**
   - Paying a supplier in cash needs the cash drawer **opened first**.
   - A sale whose serial number is already under an active warranty is **blocked**.
   - Cashiers can create warranties but **can't edit or void** them (Manager and Admin only).
   - After a dropped connection at checkout, the screen says **"checking whether the sale went through…"**.
   - A **reversed supplier payment stays in the list**, struck through and marked "Reversed by …". It no longer counts.
   - A **draft PO that has payments** can't change supplier or drop below what was paid.
   - **Closing the drawer** compares the count with what the session's own movements say. A difference is booked as cash over/short.
   - **Sign out** says "Signed out." only once the server confirms it. Otherwise it warns that the server didn't confirm.
   - **Logging out, being forced out, being deactivated or having your password changed** cuts that PC's live connection at once.
   - The **online-users list** is only sent to people allowed to see it (`user.edit` or `user.force_logout`).
   - **Sales Summary** shows *Total Collected* (cash and bank only) and *On Account* (credit sales) separately. **Customer Receivables** now ages the actual open credit sales.
   - The **notification bell** shows its unread badge straight away, not only after it is clicked.
5. **Accounting choices made in Phase 4. Have your accountant confirm these** (section 3, Phase 4). They decide which accounts the new journal entries hit.

---

## 2. What was checked

All nine audits were read and the headline findings re-checked against the code (the reports cite line numbers from older commits).

| Audit | Result |
|---|---|
| Customer profile financial audit | Mostly fixed by `b14d912` before this work began |
| PO, cash drawer & payment audit | Fixed in Phases 1–4 (cheques: your decision) |
| Purchase order, inventory & payment audit | Fixed in Phases 1–4 |
| Idempotency & duplicate operations audit | Fixed in Phase 3 |
| Transaction atomicity audit | Fixed in Phase 2 |
| Invoice financial integrity audit | Fixed in Phases 1–4 (FIFO: your decision) |
| Warranty audit | Fixed in Phases 1, 2 and 4; per-unit warranties are your decision |
| User presence & logout audit | Fixed in Phases 1 and 5 |
| AI/ML feasibility audit | Not a defect list. No action needed now |

---

## 3. What was done

### Phase 0: safety net (`e49ea61`)
- A restore that hits an error now leaves the database unchanged (it ran as "success" before).
- Restore rehearsed on a copy of live data: 86 tables and 1,738 rows matched.
- `scripts/reconcile.js`: 14 read-only checks of stored balances against the records behind them. Since `48de0aa`, a check that can't run no longer stops the others.
- A disposable test database for the integration suites (section 6).

### Phase 1: wrong answers (`a83695b`)
Report discounts counted twice; invoice page showing other invoices' warranties; draft edits wiping the customer, dates and notes; payments to a closed bank account; supplier bank payments losing the bank and date; same-second logins sharing a token; the new-PO wizard claiming a failed payment; zero-total sales blocked; every browser sharing the server's PC name; usernames instead of employee names.

### Phase 2: all or nothing (`f5cb93d`)
Stock adjustments, warranties, audit entries, notifications and expense receipts now succeed or fail together with the change they belong to. Supplier cash payments refuse a closed drawer. Added the `warranty.edit` and `warranty.void` permissions.

### Phase 3: safe retries (`5c65469`, `754857f`, `19a8c8d`)
- Every money and stock command carries a request key. A repeat returns the first result instead of recording twice.
- Checkout has a checkout ID and a status lookup for lost responses.
- **New:** keys are now **required** on those routes, because every screen sends one (`19a8c8d`). The PO-comment form builds its key in a way that also works on plain-HTTP LAN tills.

### Phase 4: treasury, stock and the ledger agree (`79e6f97`, `a52471b`, `8b88ff3`, `5e05abe`, `605fbee`)
- **Treasury journals.** Every cash or bank movement that has no business document behind it now posts a balanced journal entry. Before, general-ledger cash and bank drifted away from the drawer and the banks.

  | Movement | Debit | Credit |
  |---|---|---|
  | Manual cash in / bank deposit | Cash 1001 / Bank 1002 | Owner Equity 3001 |
  | Manual cash out / bank withdrawal | Owner Equity 3001 | Cash 1001 / Bank 1002 |
  | Drawer → bank / bank → drawer | Bank / Cash | Cash / Bank |
  | Bank → bank | (no entry, stays inside 1002) | |
  | Drawer opened with more / less than it closed with | Cash / Owner Equity | Owner Equity / Cash |
  | New bank account's opening balance | Bank 1002 | Owner Equity 3001 |
  | Drawer close: short / over | Cash Over/Short **5015** / Cash | Cash / Cash Over/Short 5015 |
- **Drawer close** rebuilds expected cash from the session's opening float plus its movements, rather than trusting the stored balance. If the stored balance disagrees, that is logged (`cash_drawer.running_balance_mismatch`).
- **Warranty replacement** posts the unit's cost: debit Warranty Expense **5016**, credit Inventory 1004, in the same transaction as the stock movement.
- **Supplier payment reversal keeps the original.** The payment is marked reversed (who, when, why), its receipt file is kept, and it can't be reversed twice. Totals, statements, reports, the PO PDF and the reconciliation skip it.
- **Paid draft POs:** the supplier can't change, and the total can't drop below the amount paid. PO payment status is recalculated with the totals.
- **The PO supplier-return button** now posts the same journal as the approved-return flow: debit Accounts Payable, credit Inventory and the input VAT claimed (at the PO's rate). Resolving the return as *rejected* or *replaced* brings the units back and reverses that journal.
- **Credit isn't collected money.** Sales Summary and the analytics collection rate leave out the credit part. Receivables aging uses the open credit sales: collections pay the oldest debt first, so the newest credit sales are what's still open. A balance with no dated sale behind it counts as 60+ days.
- **Split refunds** reverse VAT worked out once for the whole refund, not rounded per tender.
- **Exchange differences** carry VAT at the original sale's rate. The replacement plan can name the tender (`differencePayment: { method: 'bank', bankAccountId }`). Cash is the default.
- Also fixed: the setup wizard opened the drawer with an employee ID where a user ID is required, so the setup float was silently dropped.

### Phase 5: logout and live presence (`8c00f78`, `d707e82`)
- New `server/services/presenceService.js` is the one place sessions end. Logout, force logout, deactivation, password change and a replaced login close the session **and** disconnect its sockets on the server. A client that ignores `force_logout` is cut off anyway and can't reconnect.
- The socket handshake also requires an active user. A role or permission change drops the user's sockets so their rooms are rebuilt on reconnect.
- The heartbeat only refreshes an open session with an unexpired token. Otherwise the socket is cut, so a closed session can't come back online.
- A session stays online while any of its tabs is connected.
- Presence is one entry per user, sent as `presence_update` only to users allowed to see it, under the same rule as `GET /presence`. The idle and timeout sweeps use conditional updates.
- The web app re-reads the online list on every reconnect, re-reads a snapshot that a live update overtook, clears the list on disconnect, and shows an error instead of hiding a failed load.
- Sign-out reports "Signed out." only once the server confirms.

### Other work in this push
- **Purchase-order discussion** (`8e8f75d`, migration 042): comments, replies and reactions on each PO. Comments can't be edited or deleted, are permission-gated and update live. The thread scrolls and opens on the latest comment.
- **Notification bell** (`b92f390`): the unread badge shows on page load, and notifications missed while offline are re-read after a reconnect.
- **Public web settings** (`d707e82`): `NEXT_PUBLIC_*` settings were never reaching the browser, so the live socket always used port 3000. This mattered for local development; Docker uses 3000 anyway.
- **Test setup** (`tests/globalSetup.js`): it no longer falls back to the app's `PG*` settings from `.env`, because the suites create and drop databases.

---

## 4. How it was verified

- Every fix has a test that **fails on the old code and passes on the new** (checked by running the tests with the old files restored).
- Server: **530 tests pass**, 7 skipped. Two files are disabled with `describe.skip`; the live concurrency test needs `RUN_PG_CONCURRENCY=1` and also passes.
- New end-to-end suites: `presenceLifecycle` (real HTTP and Socket.IO server), `treasuryLedger` (runs every treasury movement, then the reconciliation), `receivablesAging`. Supplier-return, split-refund and exchange-difference tests sit in the existing suites.
- Web: **188 tests pass**; the TypeScript check is clean.
- Checked in the running app: login, dashboard, live connection on the right port, online-users list, the bell badge, and sign-out confirmation.
- The reconciliation run on a fresh local install (setup wizard plus migrations) shows **0 differences across 14 checks**.
- The full server run occasionally dies with `Error: Channel closed` during the migration-upgrade test. That is the test runner, not a failing test; a rerun passes.

### Reconciliation baseline (copy of live data, 24 Oct 2026)
Two known differences, both explained. Compare future runs against these:
1. **20 Sep:** the drawer closed at AED 1,230 and reopened at AED 100. AED 1,130 left the drawer with no record (or it was test data).
2. **Ledger cash is AED 100 below the drawer.** That is the opening float, because opening a drawer posted no journal before Phase 4.

Phase 4 only fixes movements **from now on**. Both differences above stay in the history. If your accountant agrees, post one manual journal entry to bring 1001 in line with the drawer (and 1002 with the banks if the run shows a gap). After that, every new run should show no gap.

---

## 5. What is still to do

### Needs your accountant
- **Confirm the account mapping in Phase 4.** Owner money goes to Owner Equity 3001. Over/short goes to 5015. Warranty replacements go to 5016. If you'd rather use other accounts (for example a separate "Owner Drawings" account), it is a small change in `journalService.TREASURY_CODES`.
- **One-off opening adjustment** for the historical gaps (section 4).
- **Large drawer discrepancies need a second person.** Today the same user can `force` a close above the AED 10 tolerance. A second-person sign-in on the till is a workflow decision, so it wasn't built.
- Not added: reconciliation checks for **accounts payable** and **inventory** against their sub-ledgers. Payables are recognised at receipt while a PO's balance includes goods not yet received (and prepayments on drafts), so the two need an agreed definition first.

### Decisions only you can make
- **FIFO costing:** sales currently use the latest purchase cost.
- **One shared drawer or one per till.**
- **Cheques:** build issued, cleared and bounced states, or hide cheque as a payment method.
- **Warranty per unit** (with serials) instead of per sale line.
- **HTTPS on the shop network** for logins (the TLS gateway exists; sockets aren't routed through it yet).
- **The exchange-difference tender:** the server accepts it, but the return screen doesn't ask for it yet, so the difference is still taken as cash unless a bank is sent.

---

## 6. Running the tests on another machine

The integration suites create and drop their own databases. **Never point them at the shop database.** Always set `INVOICE_TEST_PG_*` to a throwaway Postgres as below.

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

**Local development on a PC where Postgres runs in Docker:** the API's pre-migration backup needs `pg_dump` on the PC itself. Either install the PostgreSQL client tools, or back up through the container (`docker exec <container> pg_dump -U <user> -d <db> -Fc > backup.dump`) and then run `MIGRATE_WITHOUT_BACKUP=1 npm run migrate` once.
