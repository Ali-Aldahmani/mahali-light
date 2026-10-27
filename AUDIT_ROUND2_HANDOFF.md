# Audit round 2: hand-off

**Written:** 27 October 2026, mid Phase 5. **Updated** the same day when the user stopped the session partway through parts 2–3.
**Branch:** `main`, last code commit `6fd5feb` (work in progress, see below). Nothing is pushed.
**Plan:** https://claude.ai/artifact/KfVr2QLQxVURbpcMeeEV21 (private, owner's account)
**Progress report:** [AUDIT_FIX_PROGRESS.md](AUDIT_FIX_PROGRESS.md). It's up to date through Phase 4. Phase 5 is described only here so far.

Start a new session with: *"Read AUDIT_ROUND2_HANDOFF.md and continue Phase 5, starting with 'Start here'."*

## Start here: finish and test parts 2 and 3

Commit `6fd5feb` is **work in progress**. The web type check is clean and the server modules load, but **no tests were written for it and the full suites were not run**. Do these first, in order:

1. **Finish the till's closed-drawer override prompt.** In `web/components/cashier/CashierTerminal.tsx`, `confirmPay(closedDrawerReason?)` sets `drawerOverrideOpen` to true when confirm fails with `BIZ_DRAWER_CLOSED` and the user has `cash.override_closed_drawer`. **No dialog renders it yet.** Add one next to `<CashierPaymentDialog …>`:

   ```tsx
   <ConfirmDialog
     open={drawerOverrideOpen}
     onClose={() => setDrawerOverrideOpen(false)}
     onConfirm={(reason) => { setDrawerOverrideOpen(false); confirmPay(reason); }}
     title="Take cash with the drawer closed?"
     description="This is logged as a cash-control exception."
     confirmLabel="Take the cash"
     reasonLabel="Reason"
   />
   ```

   `ConfirmDialog` already supports `reasonLabel` (added in Phase 1). Import it from `@/components/ui/ConfirmDialog`.
2. **Check the dashboard `/pos` page.** Its `submitSale` call doesn't pass `closedDrawerReason` (around line 309 of `web/app/(dashboard)/pos/page.tsx`). At minimum, show the same clear message on `BIZ_DRAWER_CLOSED`.
3. **Write `tests/integration/phase5Payments.test.js`.** Copy the harness from `draftOwnership.test.js`. Cover:
   - **SI-03:**
     - a card or transfer payment without `bankAccountId` gets 400; an inactive account gets 400
     - card stores `method 'bank'`, `tender 'card'` and the reference, and confirm posts to the chosen account (`bank_transactions` and the account balance)
     - an idempotent replay with a different tender or reference gets 409
     - a legacy `bank` payment row with no account (insert it directly) still confirms
     - `GET /bank-accounts/for-payments` works for a Cashier and returns no balances
   - **SI-06:**
     - with the drawer closed (`UPDATE cash_drawer SET status='closed'` and no open session), a cash sale confirm gets 409 `BIZ_DRAWER_CLOSED` and no session is created
     - a Manager with `closedDrawerOverride: { reason }` succeeds; the session note contains the reason and `activity_log` has `cash.closed_drawer_override`
     - a Cashier sending the override gets 403; a too-short reason gets 400
     - card-only sales still work with the drawer closed
4. **Run the full suites.** These existing tests will probably break, because they confirm cash sales with the drawer closed (they relied on auto-open):
   - `invoiceIntegrity`, `customInvoiceItems`, `auditPhase2`, `treasuryLedger`, `checkoutRecovery`, `idempotency`

   Fix them by opening the drawer in their setup (`cashService.openDrawer({ openingBalance: 0, employeeId })`), **not** by weakening the rule. Payments posted with `method: 'bank'` and no `bankAccountId` through the API also now get 400; give those tests an account.
5. **Web tests:** update `web/lib/pos/checkoutResume.test.ts` and `web/lib/cashier/cashier.test.ts` if needed (they use `method: 'bank'`), and add one for `samePayment` with card and transfer.
6. **Commit** as "fix: audit round 2, phase 5 parts 2–3 …", then continue with parts 4 and 5 below.

---

## Where things stand

| Phase | What | Status | Commit |
|---|---|---|---|
| 1 | Races and quick fixes (SI-01, SI-04, SI-07, SI-08, INV-002, INV-004, INV-005, INV-008, AUTH-05–08) | Done | `051b43d` |
| 2 | Live events follow permissions (AUTH-04) | Done | `3b0ca13` |
| 3 | HTTPS through Caddy, 15-min idle sign-out, 12-hour sessions, sign-out all devices (AUTH-01/02/03/09) | Done | `807fe66` |
| 4 | One barcode per product, cost on each movement, reorder alerts (INV-003/006/007) | Done | `428ea80` |
| 5 | Drafts, tenders, cash control | **Part 1 done** (draft ownership, SI-02). **Parts 2–3 written, not tested** (card/transfer, closed drawer). Parts 4–5 not started | `0ae6d0d`, `6fd5feb` (WIP) |
| 6 | FIFO costing (INV-001) | Not started; needs accountant sign-off | |
| 7 | Database rules (SI-05, INV-010) | Not started; after 5–6 | |
| 8 | CI fails on skipped DB tests (AUTH-13, INV-015), route-permission test, more reconcile checks | Not started | |

Tests at `0ae6d0d`: server **604 passed, 6 skipped** (the commit message says 605; 604 is right). Web: **213 passed**. Web type check clean.

---

## Phase 5: decisions the user already made

> drafts owned by their creator with a logged take-over, card and transfer split with a chosen bank account, **no cheques**, cash sales blocked when the drawer is closed (**manager override with reason**), **second approver for drawer differences above AED 10**, and the **exchange tender picker**.

### Part 1, done (`0ae6d0d`)
- `invoices.owner_id` (migration 054), set by `POST /invoices` and backfilled from `created_by` for drafts.
- `assertDraftOwner(client, invoice, userId)` in `server/services/invoiceService.js`, called under the invoice row lock in:
  - `invoicesController.updateItems`
  - `invoicePaymentsController.create` and `remove`
  - `invoiceService.confirmInvoice`

  Drafts with no owner (system replacements) are exempt.
- `POST /invoices/:id/take-over` (permission `invoice.take_over`: Admin, Manager, Cashier) moves ownership and writes `invoice_history` ('taken_over') and `activity_log` ('invoice.taken_over').
- Invoice responses include `ownerId` and `ownerName`.
- Till: `CashierTerminal.resumeSale` takes over another cashier's held sale and shows a toast.
- Tests: `tests/integration/draftOwnership.test.js`.
- `pricingRestrictions.test.js` and `authz.contract.test.js` were adjusted (permission count is now 117).

**Not done for part 1:** the dashboard `/pos` page (`web/app/(dashboard)/pos/page.tsx`) has its own resume flow, if any. Check whether it resumes drafts, and if so add the same take-over call.

### Already in migration 054, ready to use
- `invoice_payments.tender VARCHAR(20)` and `invoice_payments.reference VARCHAR(100)`
- `cash_drawer_sessions.discrepancy_approved_by UUID`
- Permissions `cash.override_closed_drawer` and `cash.approve_close` (Admin, Manager), also in `shared/permissions.js` and `server/db/seed.js`.

### What's left in Phase 5

**Parts 2 and 3 below are written in `6fd5feb` as described, except the till's override prompt. Finish and test them using "Start here" above.** The notes stay here as the design reference.

**Part 2: card and transfer with a chosen bank account (SI-03, no cheques).**
- **Storage:** keep `method = 'bank'` in the database for both card and transfer. Put `'card'` or `'transfer'` in `tender`, and the slip or transfer reference in `reference`. Reports, cancellation reversal and refunds all read `method = 'bank'`, so they keep working.
- **API** (`server/controllers/invoicePaymentsController.js`):
  - `createSchema.method` accepts `cash | card | transfer | bank | credit`. Map `card` and `transfer` to `method 'bank'` plus `tender`.
  - For `card`, `transfer` and `bank`, require `bankAccountId`, and check it's an active account (`bank_accounts`).
  - Add an optional `reference` (max 100).
  - Include `tender` and `reference` in the idempotent-replay comparison and in `shape()`.
- **Confirm:** `invoiceService.confirmInvoice` still passes `pm.bank_account_id || null` to `bankService.recordBankIn`. Leave the fallback there so drafts saved before the upgrade can still confirm. Only new payments must name an account.
- **Web:** `web/components/cashier/CashierPaymentDialog.tsx` (`METHODS`, line ~11) currently offers Cash, "Card / Bank" and Credit. Change it to:
  - Cash, Card, Bank transfer, Customer credit
  - a bank account picker for card and transfer (list from the bank accounts service), remembering the till's last choice in `localStorage` wrapped in try/catch
  - an optional reference field.

  Also check `web/lib/pos/checkout.ts` and the dashboard `/pos` page for payment method values, and the invoice detail and receipt for the label: show "Card" or "Bank transfer" when `tender` is set.
- **Tests:** a new payment without `bankAccountId` gets 400. Card and transfer post to the chosen account. `tender` and `reference` are stored. A legacy `bank` payment with no account still confirms.

**Part 3: closed drawer blocks cash sales, with a manager override (SI-06).**
- In `confirmInvoice`, the `cashService.recordCashIn` call for cash payments must pass `allowAutoOpen: false`. `cashService.postTransactionWith` already throws `BIZ_DRAWER_CLOSED` (409) when `allowAutoOpen` is false.
- **Override:** the confirm body takes `closedDrawerOverride: { reason }` (5–500 characters). The controller checks `cash.override_closed_drawer`, and the service passes `allowAutoOpen: true` with a note such as `Opened by <user> for a cash sale: <reason>`. Log `activity_log` action `cash.closed_drawer_override`.

  To carry the note, `postTransactionWith` needs an `autoOpenNote` param: the auto-open insert currently hard-codes 'Auto-opened by system'.
- **Web:** when confirm returns `BIZ_DRAWER_CLOSED`, the till shows "Open the drawer first" with a button to the drawer. Users with the override permission also get "Take the cash anyway" plus a reason field, which resends confirm with `closedDrawerOverride`.
- **Tests:** a cash sale with the drawer closed gets 409 and no session is auto-opened. With an override from a Manager it succeeds and is logged. A Cashier override gets 403.

**Part 4: second approver for drawer differences above AED 10.**
- `cashService.closeDrawer({ force })` currently lets the same user force a close above `DISCREPANCY_TOLERANCE` (AED 10).
- **Change:** above the tolerance, require `approver: { username, password }`. That person must be a different, active user with `cash.approve_close`, checked with bcrypt against `users.password_hash`. Throw a clear 403 or 409 otherwise.
- Store `discrepancy_approved_by`, and log `cash_drawer.close_approved` with both names.
- **Controller:** `server/controllers/cashDrawerController.js` (schema around line 56: `force`).
- **Web:** the close-drawer dialog (search `closeDrawer` in `web/`) asks for the second person's username and password when the server answers `BIZ_DISCREPANCY_NEEDS_APPROVAL`.
- **Tests:** same user forcing gets refused. A wrong password gets refused. A user without the permission gets refused. A Manager approving works and is stored.

**Part 5: exchange difference tender picker.**
- The server already accepts `differencePayment: { method: 'cash' | 'bank', bankAccountId }` in the replacement plan (`server/services/returnService.js`, around line 1500).
- Add a picker on the return screen's exchange step: cash, or a bank account. Look under `web/app/(dashboard)/returns/` for the replacement or exchange UI.
- **Test:** a web test that the picker sends `differencePayment`.

**Then:** run the full suites, update `AUDIT_FIX_PROGRESS.md` (status line, migration 054 in "Before you deploy", staff notices, a "Round 2, Phase 5" section, test count), and commit.

---

## Phases 6–8 (from the plan)

- **6. FIFO (INV-001):**
  - `cost_layers` and `movement_layer_allocations` tables.
  - An opening layer per variant at cutover, using today's stock at today's cost.
  - Stock in adds a layer; stock out takes from the oldest under the variant lock in `applyStockMovement`.
  - Invoice lines, journals and `stock_movements.unit_cost` use the consumed cost.
  - Valuation from the remaining layers, plus a reconcile check that layers equal `stock_qty`.
  - Rehearse on a copy of live data, and get the accountant to sign off first.
- **7. Database rules (SI-05, INV-010):**
  - Validate the `NOT VALID` CHECKs from 047 against a live copy.
  - New `NOT VALID` CHECKs: status and type values, the payment method list, non-negative money, `qty_after = qty_before + quantity`, line and invoice arithmetic.
  - Validate them in the following release.
- **8. CI:**
  - `REQUIRE_DB_TESTS=1` in `.github/workflows/build.yml` and `release.yml`, so database suites that skip fail the build.
  - A router-walk test that every authenticated route has permission middleware.
  - Reconcile checks: `stock_qty` vs the movement sum, PO received vs purchase movements.
  - After Phase 8, delete `AUTHENTICATION_AUTHORIZATION_AUDIT.md` (all its findings are then closed).

Also open: **INV-009**. The user agreed the shop is single-location. Write that into README.md and docs/SETUP_GUIDE.md and close the finding.

---

## How to work on this repo

**Throwaway test database.** Never use the shop database. Port 5432 is the dev `mahali-pg` container.

```bash
MSYS_NO_PATHCONV=1 docker run -d --name mahali-test-pg -e POSTGRES_PASSWORD=testpass -e TZ=Asia/Dubai -e PGTZ=Asia/Dubai -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data postgres:16-bookworm
```

```bash
INVOICE_TEST_PG_PORT=55432 INVOICE_TEST_PG_USER=postgres INVOICE_TEST_PG_PASSWORD=testpass RUN_PG_CONCURRENCY=1 npx vitest run
```

```bash
npm --prefix web test -- --run
```

```bash
npx --prefix web tsc --noEmit -p web
```

Remove it afterwards with `docker rm -f mahali-test-pg`.

**Proving a test catches the bug:** run the new test with the server changes stashed:
- `git stash push -- server`, run the test, then `git stash pop`.
- Move new migration files aside while doing it, so the old code doesn't see them.
- Report how many of the new tests fail on the old code.

**Conventions:**
- Each fix gets a test on real PostgreSQL in `tests/integration/` (see `draftOwnership.test.js` for the harness).
- Comments cite the audit ID (e.g. `SI-02`).
- New migrations are additive and safe on existing data.
- New permissions go in three places: the migration, `server/db/seed.js` and `shared/permissions.js`. Then bump the count in `tests/contracts/authz.contract.test.js`.
- Live events go through `emitEvent(io, event, payload)` with an entry in `server/socket/events.js`. `tests/contracts/liveEvents.contract.test.js` fails otherwise.
- Commit messages end with the `Co-Authored-By` line.

**Pitfall that cost time this session:** editing files with `node -e "…"` inside bash double quotes eats `$1`, `$${…}` and backticks in SQL strings. That happened three times. Use the editor tool for any code containing `$` placeholders or template strings, and check `$N` placeholders after any scripted edit.

**Deploy notes for the user,** collected in AUDIT_FIX_PROGRESS.md "Before you deploy":
- Migrations 050–054.
- HTTPS setup on every device: [docs/HTTPS_SETUP.md](docs/HTTPS_SETUP.md).
- Run `scripts/reconcile.js` before upgrading and look at the barcode-collision check.
- Reload every till after deploying.
