# Audit Fix Progress

**Updated:** 25 October 2026 · **Branch:** `main` · **Full plan:** https://claude.ai/artifact/GHJHoJucC9xjWufhH5RCeM (private — open with the owner's account)

This report covers the work done against the nine `*_AUDIT.md` reports in this folder, what was verified, and what is still to do. Read **"Before you deploy"** first.

**Status:** Phases 0–5 of the plan are done, and so are the findings the phases left open (section 3, "Open findings closed on 26 Oct"). What's left in section 5 is accountant checks, your decisions, and feature work the audits list as missing features.

---

## 1. Before you deploy

1. **Back up first, then rebuild Docker.** The shop runs in Docker (`bytecrapos-*`). Code changes only take effect after:
   ```bash
   docker compose up -d --build express-api nextjs
   ```
   The API applies the new migrations on start: 039, 040 and 041 (earlier phases), **042** (purchase-order comments), **043** (two new accounts, supplier payment reversal columns), **044** (one open warranty claim), **045** (customer snapshot on invoices), **046** (PO cancellation fields), **047** (database CHECKs and the balanced-journal trigger) and **049** (session last-seen). All are additive (new columns, tables, accounts, permissions, indexes and constraints) and safe on existing data: 044 skips its index if old data already has two open claims on one warranty, and 047's CHECKs are `NOT VALID`, so existing rows can't block the upgrade. (048 belongs to the record-level audit log work, which is separate.) The API refuses to migrate without a successful pre-migration backup. That is on purpose.
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
   - A **warranty claim** is refused while another claim on that warranty is open, or once the warranty was used for a replacement. A replacement must be the same product and can record a serial number.
   - A **held sale that already has payments** can be resumed at the till. A draft saved on two screens: the second save is refused with "This sale was changed on another screen".
   - **Quantities** for products sold by the piece must be whole numbers, and any quantity has at most two decimals.
   - The **"allow negative stock" setting** is gone. Selling below zero stock was never actually possible.
   - **Cancelling a PO** keeps it, marked cancelled. A confirmed PO can be cancelled while nothing is received or paid.
   - An **unattended till** now shows as idle in the online list after 5 minutes without input.
5. **Accounting choices made in Phase 4. Have your accountant confirm these** (section 3, Phase 4). They decide which accounts the new journal entries hit.

---

## 2. What was checked

All nine audits were read and the headline findings re-checked against the code (the reports cite line numbers from older commits).

The plan's phases covered each audit's headline findings. The findings they left open in code were fixed on 26 Oct (section 3).

| Audit | Result |
|---|---|
| Customer profile financial audit | Fixed by `b14d912` before this work began (timeline, transactional audit with old/new values, net cards, edit conflicts, live sync) |
| PO, cash drawer & payment audit | Fixed in Phases 1–4. Open: cheques (your decision) |
| Purchase order, inventory & payment audit | Fixed in Phases 1–4 and on 26 Oct (draft deletion, cancelling a confirmed PO) |
| Idempotency & duplicate operations audit | Fixed in Phase 3 and on 26 Oct (the remaining creates) |
| Transaction atomicity audit | Fixed in Phase 2 and on 26 Oct (database constraints, TXA-011). FIFO: your decision |
| Invoice financial integrity audit | Fixed in Phases 1–4 and on 26 Oct (F11, F13, F14, F21, F23, F24). FIFO, serial ownership (F18) and per-invoice settlement (F20): decisions / feature work |
| Warranty audit | Fixed in Phases 1, 2, 4 and on 26 Oct (F16–F18). Per-unit warranties and the "missing features" list: your decision |
| User presence & logout audit | Fixed in Phases 1, 5 and on 26 Oct (F08, F11, F16). HTTPS on the LAN (F14/F15): your decision |
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

### Open findings closed on 26 Oct (`47c0992`, `d38243a`, `a97bc92`, `8d642c0`, `626ee5b`, `cf01874`, `d685074`)
- **Warranty F16/F17:** one open claim per warranty, enforced under the warranty lock and by a partial unique index (044). A warranty already used for a replacement, one not started, or a claim for another customer is refused. Resolution relocks and rechecks the warranty: coverage voided after filing (refund, manual void) can only be rejected. Claim edits run under the claim's lock and can't reopen a resolved claim.
- **Warranty F18:** a replacement must be a variant of the warranted product; the recorded product is the unit's own; an optional serial is checked and recorded on the replacement invoice and the new warranty (new field on the resolve screen).
- **Invoice F23:** a draft save carries the `updatedAt` the screen last saw; a draft changed since is refused with 409 instead of overwritten. The till keeps it across holds, resumes and refreshes.
- **Invoice F13:** quantities are rejected (not rounded) with more than two decimals, above 1,000,000, or fractional for products sold by the piece — on new lines, custom lines and edit requests.
- **Invoice F24:** negative stock isn't supported, so the setting always reads false and can't be turned on.
- **Invoice F11:** confirmation stores the customer's name, phone, company, TRN, email and address on the invoice (045); screens and the PDF read it first. Older invoices fall back to the live record.
- **Invoice F14:** the till resumes a draft that has payments; at checkout the draft's allocations are reconciled with the current plan — unchanged ones replay by key, changed ones are removed (new `DELETE /invoices/:id/payments/:paymentId`, drafts only, kept in the invoice history).
- **PO F04:** cancelling keeps the PO with status `cancelled` and who/when/why (046). `DELETE` stays draft-only; `POST /purchase-orders/:id/cancel` also cancels a confirmed PO while nothing is received or paid.
- **TXA-011 / F21:** `NOT VALID` CHECKs for non-negative stock, quarantine, drawer and customer balances, received ≤ ordered, positive quantities and payment/expense amounts; a deferred trigger refuses any unbalanced journal entry at commit (047).
- **Remaining creates:** POs, supplier returns, return requests, manual journal entries, bills and warranty claims run once per request key; the forms send one.
- **Presence F08/F11/F16:** heartbeats report real input, and only that counts as activity (idle works); `last_seen_at` (049) tracks the connection for the 30-minute sign-out; open sessions are marked offline at startup until they reconnect; beats that change nothing within 20 seconds aren't written.

### Other work in this push
- **Purchase-order discussion** (`8e8f75d`, migration 042): comments, replies and reactions on each PO. Comments can't be edited or deleted, are permission-gated and update live. The thread scrolls and opens on the latest comment.
- **Notification bell** (`b92f390`): the unread badge shows on page load, and notifications missed while offline are re-read after a reconnect.
- **Public web settings** (`d707e82`): `NEXT_PUBLIC_*` settings were never reaching the browser, so the live socket always used port 3000. This mattered for local development; Docker uses 3000 anyway.
- **Test setup** (`tests/globalSetup.js`): it no longer falls back to the app's `PG*` settings from `.env`, because the suites create and drop databases.

---

## 4. How it was verified

- Every fix has a test that **fails on the old code and passes on the new** (checked by running the tests with the old files restored).
- Server: **558 tests pass**, 6 skipped (two files disabled with `describe.skip`), run with `RUN_PG_CONCURRENCY=1` so the live concurrency test is included.
- New end-to-end suites: `presenceLifecycle` (real HTTP and Socket.IO server), `treasuryLedger` (runs every treasury movement, then the reconciliation), `receivablesAging`, `warrantyClaims`, `invoiceDraftRules`, `dbConstraints`, `createRetries`. Supplier-return, split-refund, exchange-difference and PO-cancellation tests sit in the existing suites.
- Web: all tests pass; the TypeScript check is clean. (The web count includes tests of the separate, uncommitted record-level audit log work.)
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

### Feature work the audits list as missing
Not defects in existing code, and each needs a product decision first: serial-number ownership through receipt, sale and return (invoice F18, warranty F06/F07); per-invoice settlement of customer debt (invoice F20 — aging now approximates it from the open credit sales); warranty policy versions, certificates, repair orders and a supplier RMA ledger (warranty audit section 22); a durable outbox for post-commit notifications.

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
