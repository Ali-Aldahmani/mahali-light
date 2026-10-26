# Edara POS — Work Report

**Date:** 26 October 2026  
**Branch:** `main` (pushed to GitHub)  
**Scope:** work done from 21 to 26 October 2026: analytics charts, the nine audit reports, and the fixes made from them.

This is now the only report. It replaces the nine `*_AUDIT.md` files and `AUDIT_FIX_PROGRESS.md`, which were deleted so there is one place to look. Everything still open from those audits is listed in section 7. The old files are still in git history if you ever need the original wording:

```bash
git show f7b874a:POS_WARRANTY_AUDIT.md
```

---

## Contents

1. Summary
2. Before you deploy
3. Analytics work
4. The nine audits
5. Fixes made, phase by phase
6. How it was tested
7. What is still to do
8. Running the tests and checks
9. Commit list

---

## 1. Summary

| | |
|---|---|
| Audit reports reviewed | 9 (about 200 findings, many repeated across reports) |
| Fix phases finished | Phase 0, 1, 2 and 3 (out of 6) |
| Phases left | Phase 4 (accounting), Phase 5 (logout and presence) |
| Database migrations added | 039, 040, 041 (all additive and safe on existing data) |
| Server tests | 483 passing |
| Web tests | 172 passing, TypeScript check clean |
| Code changed | 91 files, about 5,300 lines added |

**In plain words:**
- Reports show the right numbers.
- Backups restore fully or not at all.
- Each operation either fully completes or leaves nothing behind.
- A retry after a timeout no longer charges, pays or moves stock twice.
- A dropped connection at the till no longer tells the cashier a sale failed when it may have gone through.

What's left is making the accounting ledger agree with cash, bank and stock (Phase 4), tightening logout and online status (Phase 5), and a list of product decisions.

---

## 2. Before you deploy

The code is on GitHub, but **the shop's Docker containers have not been rebuilt**, so the shop is still running the old code.

1. **Back up the database first** from the app's backup screen.
2. **Pull and rebuild:**
   ```bash
   git pull origin main
   ```
   ```bash
   docker compose up -d --build express-api nextjs
   ```
   The API applies migrations 039, 040 and 041 by itself when it starts. All three only add things (a new table, new nullable columns, new permissions), so nothing existing is changed or removed.
3. **Check it started:** open the app, sign in, make a test sale, then cancel it.
4. **Run the reconciliation check** (section 8) and compare against the baseline in section 6. A new difference means stop and look.

### What staff will notice

| Change | Why |
|---|---|
| Paying a supplier in cash needs the cash drawer **opened first**. | It used to open the drawer silently, putting the money in a session nobody started. |
| A sale whose serial number already has an active warranty is **blocked**. | It used to go through and quietly skip the warranty. |
| Cashiers can still create warranties but **can no longer edit or void them**. Managers and Admins can. | Cashiers could change any warranty's dates or cancel it. |
| After a dropped connection at checkout, the screen says **"Checking whether the sale went through…"**. | It used to say "sale was not completed" even when the sale had been saved. |
| The timeout **Retry** button only appears when retrying can't record something twice. | Retry used to re-send any request, including payments. |
| Two PCs signed in as the same user **both stay signed in**. | They used to kick each other out. |
| The online-users list shows **employee names** instead of usernames. | |

---

## 3. Analytics work

All on the **Analytics → Overview** tab.

| Change | Detail |
|---|---|
| **Net profit trend** | Replaced with an animated bar chart. A month picker in the card's top right offers the current month and the 6 before it. Loss days drop below a zero line in red. |
| **Sales by category** | New donut chart next to net profit. |
| **Bills & Expenses** | New streamgraph by category across months, with year buttons in the top right. |
| **Daily new invoices** | New brush chart (drag to zoom a date range) next to Bills & Expenses. |
| **Loading state** | Skeletons now match the real layout instead of showing one card. |
| **Date fixes** | Net profit and the sales timeline showed every day one day early (a time-zone bucket bug). Peaks, peak heatmap, sales timeline and category breakdown ignored the chosen date range (a `date_from` vs `dateFrom` mismatch). |

---

## 4. The nine audits

Each audit was read in full and its headline findings re-checked against the actual code, since the reports cite line numbers from older versions. 36 findings were checked directly, and 34 of them were real.

| Audit | What it covered | Status now |
|---|---|---|
| Customer profile financial audit | Customer cards, timeline, audit trail, edits | **Fixed** (commit `b14d912`, before the phased work began) |
| PO, cash drawer & supplier payment audit | Paying suppliers from cash or bank | Most fixed in Phases 1–3; accounting items left for Phase 4 |
| Purchase order, inventory & payment audit | Creating, receiving and paying POs | Most fixed in Phases 1–3; some left (section 7) |
| Idempotency & duplicate operations audit | Retries posting things twice | **Fixed** in Phase 3 |
| Transaction atomicity audit | Operations that half-complete | **Fixed** in Phase 2; accounting items left for Phase 4 |
| Invoice financial integrity audit | Invoice totals, reports, balances, restore | Report and restore bugs fixed; accounting and FIFO left |
| Warranty audit | Warranty creation, returns, claims | Main bugs fixed; claims and per-unit work left |
| User presence & logout audit | Online status, sessions, logout | Quick fixes done; Phase 5 left |
| AI/ML feasibility audit | Whether forecasting is possible | Not a bug list; nothing to fix now |

**Overall picture:** the core sale, return and PO receiving code was solid: it locks the right rows and rolls back together. The problems were around it:
- retries posting twice;
- writes that escaped their transaction;
- reports with wrong numbers;
- sessions not staying in sync.

---

## 5. Fixes made, phase by phase

### Phase 0 — Safety net · commit `e49ea61`

| Fix | Detail |
|---|---|
| **Restore reported failure as success** | `pg_restore` exit code 1 means some objects failed, but it was counted as a success, leaving a half-restored database. Restores now run as one transaction (`--single-transaction --exit-on-error`) and only exit 0 counts as success. A failed restore leaves the current database untouched. |
| **Restore rehearsal** | A dump of the live data was restored into a test database: all 86 tables and 1,738 rows matched. |
| **Reconciliation check** | New `scripts/reconcile.js`: 14 read-only checks comparing stored totals with the records behind them (drawer, bank, customer balances, invoice and PO payments, stock vs movements, journal balance, ledger cash/bank vs drawer/bank). It cannot change data. |
| **Disposable test database** | A throwaway Postgres in Docker (memory only) for the integration tests, so tests never touch the shop data. |

Files: `server/backup/strategies/dbBackup.js`, `scripts/reconcile.js`, `tests/unit/dbRestore.test.js`, `tests/integration/reconcile.test.js`.

### Phase 1 — Wrong answers · commit `a83695b`

| # | Bug | Fix | Where |
|---|---|---|---|
| 1 | Reports counted invoice discounts twice (AED 20 line + AED 10 invoice discount showed AED 40). | Use `discount_amount` alone, which already includes the invoice discount. | `reportService.js`, `analyticsService.js` |
| 2 | The invoice page showed warranties from other invoices. | Filter the warranty list by `invoice_id`. | `warrantiesController.js` |
| 3 | Editing a draft invoice removed its customer; editing a draft PO wiped expected date, due date and notes. | Only change a field when it's actually sent. Sending an empty value still clears it. | `invoicesController.js`, `purchaseOrdersController.js` |
| 4 | Payments could go to a closed bank account. | Rejected, except reversals of old payments, which may still return money to it. | `bankService.js` |
| 5 | Supplier bank payments didn't save which bank was used or the payment date; reversals went to today's default bank and were credited to the original payer. | Save the actual bank and date; reverse to that bank, recorded under the user doing the reversal. | `supplierPaymentService.js` |
| 6 | Two logins in the same second got identical tokens. | Each token gets a random ID. | `middleware/auth.js` |
| 7 | The new-PO wizard said "payment recorded" when the payment failed. | Reports what actually happened. | `web/lib/purchases/newPoMessage.ts` |
| 8 | A fully discounted (AED 0) sale couldn't be completed. | Allowed; only negative totals are blocked. | `CashierPaymentDialog.tsx` |
| 9 | Every browser used the server's name as its PC ID, so two PCs on one user replaced each other's session. | Each browser makes and keeps its own ID. | `web/lib/config.ts` |
| 10 | The online-users list showed usernames. | Shows employee names; later updates no longer erase fields. | `PresenceWidget`, presence store, socket |

Tests: `tests/integration/auditQuickFixes.test.js`, `tests/integration/reportDiscounts.test.js`, plus web tests.

### Phase 2 — All or nothing · commit `f5cb93d`

| Fix | Before | After |
|---|---|---|
| **Direct stock adjustment** | Stock moved first; if saving the approval record then failed, stock had changed with no record. | Stock, journal, approval record and audit entry save together or not at all. |
| **Sale warranties** | Created after the sale was saved; a failure was only logged to the console, so the sale had no warranty. | Created inside the sale and voided inside a cancellation. A warranty problem now stops the sale with a clear error. |
| **Partial return** | Returning 1 of 3 units voided the warranty for all 3. | Cover stays for the units the customer keeps, and ends when the last unit comes back. |
| **Financial audit trail** | Audit rows were written separately and could silently fail. | Written inside the same transaction for returns, expenses, cash open/close/adjust, bills, warranties, supplier payments, PO receipts, and bank and treasury movements. A failed audit write cancels the operation. |
| **Notifications** | Return-request and warranty notifications were sent before the change was saved. | Sent only after it's saved. |
| **Expense receipts** | The receipt file was deleted before the expense, so a failure left an expense with no file. A failed upload looked like a failed expense, inviting a duplicate. | The file is deleted after the expense; a failed upload is reported as just that. |
| **Supplier cash payment** | Silently opened a closed drawer. | Refused with "open the cash drawer first". |
| **Warranty permissions** | Cashiers could edit and void any warranty. | New `warranty.edit` and `warranty.void` for Manager and Admin. Migration 039 gives them to custom roles that could already create warranties, so nobody loses access by surprise. |

Tests: `tests/integration/auditPhase2.test.js`; the permissions contract test now expects 110 permissions.

### Phase 3 — Safe retries · commits `5c65469` and `754857f`

**The problem:**
1. A cashier presses Pay.
2. The server saves the payment.
3. The reply is lost (Wi-Fi drop, timeout).
4. The cashier presses again, and the payment is saved a second time.

The same applied to supplier payments, stock receipts, expenses and cash and bank movements.

**The fix:**
- Each form creates a **request key** when it opens and sends it with every attempt.
- The server records the key in a new `operations` table (migration 040), in the same transaction as the work.
- A repeat with the same key gets the first result back instead of doing the work again.
- The same key sent with different details is refused (error 409).
- Two copies arriving at the same moment are handled one after the other.

**Covered:** customer payment collection, supplier payment, PO receipt, expense, manual cash adjustment, cash-to-bank transfer, and bank deposit, withdrawal and transfer.

**Retry button:** the timeout Retry button now only appears for reads and keyed requests. Otherwise it says the change may already be saved.

**Checkout:**
- Each sale gets a **checkout ID**. It's kept in the sale backup, so a page refresh keeps it, along with the payment keys.
- Sending the same sale twice returns the same invoice (migration 041), never two.
- New `GET /invoices/checkout/:checkoutId` answers "what happened to this sale?": not started, draft, completed or cancelled.
- After a lost connection, both checkout screens ask that question, up to 3 times. They then show one of three results:
  - the completed sale and receipt;
  - "not completed, try again";
  - "can't tell yet, check before ringing it up again".

  They never say "not completed" unless the server confirmed it.

Main files:
- Server: `server/utils/operations.js` and `shared/errorCodes.js`.
- Web: `web/lib/requestKey.ts`, `web/hooks/useRequestKey.ts`, `web/lib/pos/checkout.ts`, `web/store/posStore.ts`, `web/hooks/useSaleBackup.ts`, `CashierTerminal.tsx` and `app/(dashboard)/pos/page.tsx`.

Tests:
- `tests/integration/idempotency.test.js` covers every keyed command (same key twice, at the same time, and with different details).
- `tests/integration/checkoutRecovery.test.js` has 6 tests.
- `web/lib/pos/checkoutRecovery.test.ts` has 7 tests.
- `web/lib/requestKey.test.tsx`.
- The `CashierTerminal` tests.

---

## 6. How it was tested

- **Every fix has a test that fails on the old code and passes on the new one.** This was checked by running each test against the old files. For example, 5 of the 6 checkout tests fail against the old controller; the sixth checks behaviour that was already right.
- **Server:** 483 tests pass (26 Oct 2026). 7 are skipped; they need settings not used here and were skipped before too.
- **Web:** 172 tests pass, and the TypeScript check is clean.
- **Reconciliation** on a copy of the live data was the same before and after every phase.
- **Known noise:** the full server run sometimes stops with `Error: Channel closed` during the migration-upgrade test. That's the test runner, not a failing test, and a rerun passes.

### Reconciliation baseline (copy of live data, 24 Oct 2026)

There are two known differences, both explained. Compare future runs against these:

1. **20 September:** the drawer closed at AED 1,230 and the next session opened at AED 100. AED 1,130 left the drawer with no record. It was either cash taken out without being entered, or test data. **Worth asking whoever closed that day.**
2. **Ledger cash is AED 100 below the drawer.** That's the opening float, because opening a drawer posts no journal entry. Phase 4 fixes this.

---

## 7. What is still to do

### 7.1 Deploy (now)

Pull, back up, rebuild and check, as in section 2.

### 7.2 Finish Phase 3

- **Make request keys required.** They're optional today so older open browser tabs keep working. Once every till has reloaded the new version, make the server reject a money or stock command with no key.
- **Return approval retries** (idempotency audit ID-10): approving a return happens at most once, but a retried approval gets an error instead of the original result. Give it a request key like the others.
- **Show duplicate attempts in the audit log** (ID-11): log when a request is answered from a stored result, so repeated attempts are visible.

### 7.3 Phase 4 — Make cash, bank, stock and the ledger agree

**Needs your accountant.** Agree each journal entry on paper before any code.

| # | Task | Why |
|---|---|---|
| 1 | **Journal entries for manual cash and bank movements** (adjustments, deposits, withdrawals, transfers) | Today they change the drawer or bank balance but not the ledger, so ledger cash drifts from real cash. |
| 2 | **Opening float journal** | Explains the AED 100 baseline difference. |
| 3 | **Drawer close recomputes expected cash and posts over/short** | Expected = opening + movements, not a stored running total. Large differences need a second person. Today closing doesn't check the ledger. |
| 4 | **Supplier payment reversal keeps the original record** | Today the payment row is deleted; it should be marked reversed and linked, like customer payment voids. |
| 5 | **Warranty replacement posts its cost** | Debit warranty expense, credit inventory. Today stock leaves with no journal. |
| 6 | **Credit sales aren't "collected"** | Reports count credit (unpaid) sales as money collected. Debt aging should use open invoices, not the customer's total balance. |
| 7 | **VAT on split refunds** | Splitting one refund into several changes the VAT reversed. |
| 8 | **VAT and cash on exchange differences** | Exchanges hardcode zero VAT and cash for the price difference. |
| 9 | **PO supplier-return button** | Moves stock but posts no journal and doesn't change what's owed to the supplier. It should use the accounting-aware return flow. |
| 10 | **Block editing a paid draft PO** | A draft with payments can be moved to another supplier or have its total cut below what was paid. |
| 11 | **Cheques** | A cheque marks a PO paid with no journal and no clearing step (see decisions). |
| 12 | **Return and exchange reports** | Report cost and net sales don't match the journals for returns and exchanges. |
| 13 | **Database checks for money rules** | Add database-level checks (e.g. paid ≤ total, one open drawer session) so bad data can't be written even by a bug. |

**Done when:** the reconciliation check shows ledger cash = drawer + bank, and supplier balances and stock value tie to their records.

### 7.4 Phase 5 — Logout and online status

| # | Task | Why |
|---|---|---|
| 1 | **Disconnect live connections on logout, deactivation and password or role change** | Today a logged-out or disabled user keeps receiving live updates until they close the tab. |
| 2 | **Heartbeat must not revive a logged-out session** | The heartbeat marks any session online again, even after logout. |
| 3 | **Count open tabs before showing a user offline** | Closing one tab hides a user who still has another open. Also re-load the online list after reconnecting, so missed events don't leave it wrong. |
| 4 | **Logout says "signed out" only when the server confirms** | Today a failed logout still clears the browser, while the session stays valid on the server. |
| 5 | **Only users allowed to see presence receive presence events** | The REST list needs `user.edit`, but live events go to everyone. |
| 6 | **One definition of "online"** | The Users page and the online widget use different rules, and the Users page doesn't update live. |
| 7 | **Idle detection** | Heartbeats keep an idle user looking active forever. |
| 8 | **Stale presence after a server restart** | Presence saved before a restart is shown as current. |
| 9 | **Concurrent login and logout edge cases** | Session changes need "only if still in this state" checks. |
| 10 | **Heartbeat load** | One database write per heartbeat per tab, unlimited. Throttle it. |
| 11 | **Header name** | The top bar shows the username and doesn't update when the name changes. |

**Done when:** a logged-out or disabled user stops receiving anything within seconds, and two PCs on one user both stay signed in.

### 7.5 Warranty work still open

The main bugs were fixed in Phases 1–2. These remain from the warranty audit:

| Item | Detail |
|---|---|
| **Duplicate claims** | More than one open claim can be made on the same warranty, and claims can be made on voided or not-yet-active warranties. |
| **Claim resolution** | Closing a claim doesn't re-check the warranty is still valid; editing and closing a claim at the same time can clash. |
| **Replacement product** | A claim replacement can be a different product and loses the serial number. There's no field to enter the new serial. |
| **Manual registration screen** | The product and invoice pickers use the wrong API response shape, and the screen can't record where the item was bought. It should also check the item was really sold. |
| **Dates and extensions** | Edited dates and durations can contradict each other, and extending an expired warranty doesn't make it active again. Status can be stale until something refreshes it. |
| **Invoice corrections** | Correcting a confirmed invoice can detach old warranties and not create new ones. |
| **Return/exchange replacements** | Goods given in an exchange don't get a warranty or serial registration. |
| **Customer history** | Users without warranty permission can see warranties through the customer profile. |
| **Policy snapshot** | The warranty doesn't keep a copy of the terms at the time of sale, so changing a product's warranty later changes the meaning of old ones. |
| **Supplier vs customer cover** | One serial can't correctly have both supplier and customer warranty at once. |
| **Dashboard figures** | Counts and claim rates don't measure active cover or real defects consistently. |
| **Large histories** | Warranty lists and searches aren't paged and will slow down as data grows. |
| **Certificates** | No printable warranty certificate. |

### 7.6 Other open items from the audits

| Area | Item |
|---|---|
| Invoices | Customer name and phone aren't copied onto the invoice, so editing a customer changes old invoices. |
| Invoices | Quantity precision and units aren't validated the same way everywhere (fractional quantities on whole-unit items). |
| Invoices | Two people editing the same draft at once: the last save silently wins. |
| Invoices | A draft that already has payments has no clear screen to resume it. |
| Invoices | The "allow negative stock" setting conflicts with the central stock check. |
| Invoices | Serial numbers aren't tied to the physical unit that was sold. |
| Purchase orders | A PO line's product and variant can disagree. |
| Purchase orders | The new-PO screen's tax and shipping preview doesn't match how the server calculates them. |
| Purchase orders | Deleting a draft PO is logged as a cancellation and the PO isn't kept. |
| Purchase orders | Fractional partial receipts can slightly overstate stock value and the supplier balance. |
| Purchase orders | Live updates miss some PO status changes, and some lists refresh with their old filters. |
| Cash drawer | Which payment methods a user may fund from isn't checked per method. |
| Cash drawer | Supplier payments and their cash or bank movements have no direct link to each other. |
| Restore | Warranty and other tables are restored fine now; add a periodic restore drill to confirm it. |

### 7.7 Decisions only you can make

These change the scope of Phase 4, so decide them first.

| Decision | Options |
|---|---|
| **FIFO costing** | Sales use the latest purchase cost today. FIFO means cost layers per receipt, a big change. Ask your accountant whether latest cost or weighted average is acceptable. |
| **One drawer or one per till** | All PCs share one cash drawer. If each counter has its own cash box, drawers need to be tied to terminals and cashiers. |
| **Cheques** | Build issued, cleared and bounced states, or hide cheque as a payment method until then. |
| **Warranty per unit** | A line of 3 units has one warranty. Per-unit warranties with serials handle returns and claims properly, but it's a bigger change. |
| **HTTPS on the shop network** | Login tokens travel over plain HTTP on the LAN. The HTTPS gateway exists, but live updates aren't routed through it yet. |
| **AI forecasting** | Not needed now. If wanted later, start by recording the data the AI audit listed (each stock receipt, stock-outs, prices and promotions, return reasons), then try a demand forecast in "suggest only" mode for one store. |

---

## 8. Running the tests and checks

**Never point the tests at the shop database.** The integration tests create and delete databases. If no port is given, they use port 5432, which on a machine with a local Postgres is a real database.

Start a throwaway Postgres (memory only, gone when stopped):
```bash
MSYS_NO_PATHCONV=1 docker run -d --name mahali-test-pg -e POSTGRES_PASSWORD=testpass -e TZ=Asia/Dubai -e PGTZ=Asia/Dubai -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data postgres:16-bookworm
```
If it already exists from before:
```bash
docker start mahali-test-pg
```
Server tests:
```bash
INVOICE_TEST_PG_PORT=55432 INVOICE_TEST_PG_USER=postgres INVOICE_TEST_PG_PASSWORD=testpass npx vitest run
```
Web tests and type check:
```bash
npm --prefix web test && npx --prefix web tsc --noEmit -p web
```
Reconciliation check (read-only, safe on the shop database; fill in its connection details):
```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=... PGDATABASE=... node scripts/reconcile.js
```

---

## 9. Commit list

Oldest first, all on `main`:

| Commit | What |
|---|---|
| `b14d912` | Customer profile: audit trail, financial cards, live sync |
| `0f221e1` | Analytics: net profit bars, category donut |
| `d3d2e91` | Dashboard sales timeline updates, first audit reports |
| `f6bb3c0` | Analytics: Bills & Expenses streamgraph |
| `f9bdcd9` | Analytics: daily invoices chart, net profit day-shift fix |
| `e66a4c0` | App-shaped loading skeletons |
| `e49ea61` | **Phase 0:** restore fix, reconciliation check |
| `a83695b` | **Phase 1:** ten quick fixes |
| `f5cb93d` | **Phase 2:** all-or-nothing operations |
| `5c65469` | **Phase 3:** retry-safe money and stock commands |
| `754857f` | **Phase 3:** checkout ID and lost-response recovery |
| `247c20a` | Analytics date-range fixes |
| `c3a0bf8` | README update |
| `f7b874a` | Remaining audit reports and progress report (now removed) |
| `a454a35` | README documentation (yours) |
| `d1e4624` | Checkout tests confirmed passing |
| *next* | This report; old reports removed |
