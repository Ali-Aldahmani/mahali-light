# Audit Fix Progress

**Updated:** 27 October 2026 · **Branch:** `main` · **Round 1 plan:** https://claude.ai/artifact/GHJHoJucC9xjWufhH5RCeM · **Round 2 plan:** https://claude.ai/artifact/KfVr2QLQxVURbpcMeeEV21 (both private — open with the owner's account)

This report covers the work done against the `*_AUDIT.md` reports in this folder, what was verified, and what is still to do. Read **"Before you deploy"** first.

**Status:**
- **Round 1** (the first nine audits): Phases 0–5 are done, and so are the findings the phases left open (section 3, "Open findings closed on 26 Oct").
- **Round 2** (the authentication, inventory and sales & invoices audits of 26 Oct): Phases 1–4 are done (section 3, "Round 2, Phase 1" to "Round 2, Phase 4"). Phases 5–8 are in the round 2 plan.

What's left in section 5 is accountant checks, your decisions, feature work the audits list as missing, and round 2 Phases 2–8.

---

## 1. Before you deploy

1. **Back up first, then rebuild Docker.** The shop runs in Docker (`bytecrapos-*`). Code changes only take effect after:
   ```bash
   docker compose up -d --build
   ```
   The API applies the new migrations on start: 039, 040 and 041 (earlier phases), **042** (purchase-order comments), **043** (two new accounts, supplier payment reversal columns), **044** (one open warranty claim), **045** (customer snapshot on invoices), **046** (PO cancellation fields), **047** (database CHECKs and the balanced-journal trigger), **049** (session last-seen), **050** (one open session per user per PC, login lockout table), **051** (session maximum length, token rotation), **052** (one barcode per product) and **053** (cost on each stock movement). All are additive (new columns, tables, accounts, permissions, indexes and constraints) and safe on existing data: 044 skips its index if old data already has two open claims on one warranty, 047's CHECKs are `NOT VALID`, so existing rows can't block the upgrade, 050 first closes duplicate open sessions on the same PC (keeping the newest), as a new login would have, 051 gives open sessions their sign-in time plus 12 hours, and 052 never fails on duplicate barcodes: the oldest product keeps each code and the upgrade log says how many there were. (048 belongs to the record-level audit log work, which is separate.) The API refuses to migrate without a successful pre-migration backup. That is on purpose.
2. **Run the reconciliation before and after the deploy** (section 6) and compare with the baseline in section 4. A new difference means stop and investigate. Look at its new "Barcodes that belong to more than one active product" check first: after the upgrade, each product listed there stops matching scans on that code until its barcode is changed.
3. **Switch every till and phone to HTTPS (round 2, Phase 3).** Set `SERVER_IP` in `.env` before rebuilding. In the Windows firewall allow 443 and 80 and remove the old rule for 3000. Trust the shop certificate on each device and change every bookmark to `https://SERVER_IP`: [docs/HTTPS_SETUP.md](docs/HTTPS_SETUP.md). Port 3000 now answers the server PC only, and the API refuses plain HTTP from other machines.
4. **Reload every till's browser after the deploy.** Money and stock actions now *require* a request key. A page loaded before the update doesn't send one and gets "This screen is out of date. Reload the page and try again."
5. **Things staff will notice:**
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
   - **Cancelling a confirmed invoice** asks for a reason (5 to 500 characters).
   - The **invoice discount** can't be more than the items' total.
   - **New passwords** need at least 10 characters (12 for Admin), and common ones are refused. Existing passwords keep working until they're next changed.
   - **Five wrong passwords** lock that username out on that PC for 15 minutes. The person's own till still signs in. **Unlock sign-in** on the Users page clears it early.
   - An **inactive account** now sees "wrong username or password", like any failed login.
   - **Stock quantities** with more than two decimals, or part pieces for products sold by the piece, are refused on every stock screen, not only at the till.
   - An **adjustment can't be applied** to a product while a stock count that covers it is open.
   - **Live updates follow each person's permissions.** Cashiers now see drawer, customer-balance and invoice updates live (they could already open those pages). A user denied a permission, and roles without it (for example Warehouse for cash and invoices), no longer get those updates. Custom roles get the updates for the permissions they have.
   - **The POS address is `https://SERVER_IP`.** Plain http redirects there.
   - **A screen with no keyboard, mouse or touch input for 15 minutes signs out,** with a one-minute warning first. A closed screen still signs out after 30 minutes.
   - **Everyone signs in again 12 hours after signing in,** however busy the till is (about once a shift).
   - **"Sign out all my devices"** in the account menu closes the person's sessions on every PC and phone.
   - **A barcode can belong to one product only,** across the barcode and supplier-barcode fields and ignoring spaces and upper/lower case. Saving a duplicate says which product already has it. A deactivated product frees its codes.
   - **Stock movement history shows the cost each movement happened at.** Movements from before the update show "Not recorded".
   - **Changing a reorder level** creates or clears the low-stock alert straight away.
6. **Accounting choices made in Phase 4. Have your accountant confirm these** (section 3, Phase 4). They decide which accounts the new journal entries hit.

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
| User presence & logout audit | Fixed in Phases 1, 5 and on 26 Oct (F08, F11, F16). HTTPS on the LAN (F14/F15): round 2, Phase 3 on 27 Oct |
| AI/ML feasibility audit | Not a defect list. No action needed now |
| Authentication & authorization audit (round 2) | Phase 1 on 27 Oct: AUTH-05 to AUTH-08. Phase 2 on 27 Oct: AUTH-04. Phase 3 on 27 Oct: AUTH-01, AUTH-02, AUTH-03, AUTH-09. All findings closed |
| Inventory integrity audit (round 2) | Phase 1 on 27 Oct: INV-002, INV-004, INV-005, INV-008. Phase 4 on 27 Oct: INV-003, INV-006, INV-007. Open: INV-001 (FIFO) in Phase 6, INV-010 in Phase 7, INV-009 (write down single location) |
| Sales & invoices audit (round 2) | Phase 1 on 27 Oct: SI-01, SI-04, SI-07, SI-08. Open: SI-02 (draft ownership), SI-03 (tenders), SI-05 (database rules), SI-06 (closed drawer) |

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

### Round 2, Phase 1: races and quick fixes (27 Oct, migration 050)
- **Rejections can't overwrite approvals (SI-01, INV-002):** rejecting an invoice edit, a stock adjustment or a stock count locks the record and only succeeds while it is still pending, in one transaction with its history and audit entries.
- **Counts and adjustments don't cross (INV-005):** starting a count and applying an adjustment share one lock and recheck inside it, so two counts can't start together and an adjustment can't land on a product a count has just covered.
- **Lock order (SI-08):** sales, cancellations and approved edits lock products in id order (`stockService.lockVariants`). These three transactions run again, up to 3 times, if PostgreSQL ends one to break a deadlock (`withTransaction(fn, { retryOnDeadlock: true })`).
- **Invoice discount cap (SI-04):** a discount above the items' total after line discounts is refused; the till caps the field.
- **Cancellation reason (SI-07):** required for confirmed invoices (5–500 characters); the cancel dialog asks for it. Abandoning a draft doesn't need one.
- **One quantity rule (INV-004):** `server/utils/quantity.js` is used by sales, openings, receipts, adjustments, counts and PO lines, and `applyStockMovement` checks it for every stock change. Rounding is now to the columns' two decimals.
- **Retry-safe product creates (INV-008):** product and variant creation run once per request key; the forms send one.
- **Login (AUTH-05 to AUTH-08):** each attempt is counted per username and address in one atomic upsert before the password is checked (`login_lockouts`), a success clears it, and an Admin can unlock (`POST /users/:id/unlock-login`, logged). One open session per user per PC, under a lock and a unique index. Passwords: 10 characters (12 for Admin), common ones refused, one bcrypt cost (`server/utils/password.js`). Inactive accounts get the same 401 as a wrong password; the reason goes to the activity log.

### Round 2, Phase 2: live events follow permissions (27 Oct)
- **AUTH-04:** each socket joins one room per effective permission (role permissions plus the user's own grants, minus their denies), loaded at the handshake. Every broadcast goes through `emitEvent` (`server/socket/events.js`), which maps each of the 60 events to the permission of the matching GET route; an event missing from the map throws instead of going to everyone. About 150 sends to everyone or to the Manager/Admin rooms were moved to it.
- Events for one person (the requester of an edit, leave or correction) go to the approvers and that person's room in one send, so nobody gets them twice.
- Restore notices still reach every screen, because a restore restarts the server. The role room is kept only so a role's permission change can drop its users' sockets; no event is sent to it.
- `liveEvents.contract` fails the build on a new direct send to everyone or to a role room, or on an event without an audience.

### Round 2, Phase 3: sessions and HTTPS (27 Oct, migration 051)
- **HTTPS (AUTH-01, presence F14/F15):** Caddy (`web-tls`) is the only way in from the LAN. It serves the web app, the API, files and live updates on `https://SERVER_IP` and redirects port 80. The API port is published on 127.0.0.1 only and the web container isn't published. In production the API refuses plain-HTTP requests and socket handshakes from other machines unless they came through a trusted proxy over HTTPS (`server/middleware/secureTransport.js`, `REQUIRE_HTTPS`). Local calls (health check, scripts) still work. Device setup: [docs/HTTPS_SETUP.md](docs/HTTPS_SETUP.md).
- **Idle sign-out (AUTH-03):** a session with no keyboard, mouse or touch input for 15 minutes (`IDLE_SIGNOUT_MINUTES`) is closed by the server sweep (`server/services/sessionPolicy.js`). Ordinary API requests no longer count as activity; the first request after input carries `X-User-Active`, so the phone screens without a live connection work too. The screen warns a minute before and signs itself out at the limit (`SessionKeeper`).
- **Session length (AUTH-02):** a session ends 12 hours after sign-in (`absolute_expires_at`, `SESSION_MAX_HOURS`). Tokens last 30 minutes (`ACCESS_TOKEN_TTL`; `JWT_EXPIRES_IN` is no longer read) and the app refreshes them two minutes early. A refresh never extends the session or counts as activity, the new token never outlives the session, and the old one works for one more minute. Live connections belong to the session and survive refreshes.
- **Sign-out that didn't reach the server (AUTH-09):** the app retries every 15 seconds while the page is open, holding the old token in memory only. New "Sign out all my devices" (`POST /auth/logout-all`).

### Round 2, Phase 4: barcodes, movement costs, reorder alerts (27 Oct, migrations 052–053)
- **One barcode, one product (INV-003):** `variant_barcodes` holds every code of every active product once (trimmed, upper case, unique), kept in step by a database trigger for every writer. A new or changed code another active product has is refused ("Barcode … is already used by …", 409). Deactivating frees codes; reactivating doesn't take back a code someone else took. Scans and the internal barcode lookup read this table, and the till's product search lists a code's owner first. Clashes from before the upgrade stay with the oldest product and are listed by the new `barcode_collisions` reconciliation check.
- **Cost on each movement (INV-007):** `stock_movements.unit_cost` (053): the receipt cost for purchases, the booked cost for sales, cancellations and edits, otherwise the product's cost at that moment, which is also what the adjustment journal now uses. Movement history shows this cost; older rows show "Not recorded".
- **Reorder alerts (INV-006):** changing a product's or variant's reorder level, or switching it on or off, rechecks its alerts in the same transaction. A new hourly job (`jobs/reorderAlertSweep.js`) rechecks every active product as a backstop.

### Other work in this push
- **Purchase-order discussion** (`8e8f75d`, migration 042): comments, replies and reactions on each PO. Comments can't be edited or deleted, are permission-gated and update live. The thread scrolls and opens on the latest comment.
- **Notification bell** (`b92f390`): the unread badge shows on page load, and notifications missed while offline are re-read after a reconnect.
- **Public web settings** (`d707e82`): `NEXT_PUBLIC_*` settings were never reaching the browser, so the live socket always used port 3000. This mattered for local development; Docker uses 3000 anyway.
- **Test setup** (`tests/globalSetup.js`): it no longer falls back to the app's `PG*` settings from `.env`, because the suites create and drop databases.

---

## 4. How it was verified

- Every fix has a test that **fails on the old code and passes on the new** (checked by running the tests with the old files restored).
- Server: **601 tests pass**, 6 skipped (two files disabled with `describe.skip`), run with `RUN_PG_CONCURRENCY=1` so the live concurrency test is included.
- Round 2, Phase 1: `auditRound2Phase1` has 15 tests on real PostgreSQL. The race tests hold a lock on a second connection to force the interleaving the audits describe. 14 fail on the old code; the lock-order test also passes there, because PostgreSQL happened to lock in id order already. The UI changes (cancel reason, discount cap, Unlock sign-in) were not checked in the running app.
- Round 2, Phase 2: `liveEventAudience` runs a real Socket.IO server: a Manager denied `cash.view`, a custom role with only `cash.view`, Warehouse and Admin; stock updates on the till and in the store room; an edit decision reaching the requester once; a permission change on reconnect. All four fail on the old code. Live updates were not checked in the running app.
- Round 2, Phase 3: `sessionLifetime` runs a real HTTP and Socket.IO server: idle, closed-screen and maximum-length sign-out, activity only from input, token rotation with the one-minute overlap, a connection outliving its first token, sign-out on all devices, and plain HTTP and plain-HTTP sockets refused. 6 of 9 fail on the old code; the other 3 call the new sweep and HTTPS check directly. New web tests cover refresh timing, the idle warning and sign-out, activity reporting and the sign-out retry. Caddy validates the new config and Compose publishes only 80 and 443 to the LAN, but the full Docker stack was not built and run end to end.
- Round 2, Phase 4: `inventoryPhase4` covers duplicate codes in any field, case or spacing, scans, deactivation, a clash from before the upgrade (still editable, scanned to the oldest product, reported), movement costs through cost changes and a sale and cancellation, and reorder alerts on level changes and in the hourly sweep. 9 of 10 fail on the old code; the plain scan with no clash already worked. Not checked in the running app.
- New end-to-end suites: `presenceLifecycle` (real HTTP and Socket.IO server), `treasuryLedger` (runs every treasury movement, then the reconciliation), `receivablesAging`, `warrantyClaims`, `invoiceDraftRules`, `dbConstraints`, `createRetries`. Supplier-return, split-refund, exchange-difference and PO-cancellation tests sit in the existing suites.
- Web: all tests pass; the TypeScript check is clean. (The web count includes tests of the separate, uncommitted record-level audit log work.)
- Checked in the running app: login, dashboard, live connection on the right port, online-users list, the bell badge, and sign-out confirmation.
- The reconciliation run on a fresh local install (setup wizard plus migrations) shows **0 differences across 14 checks** (15 checks since round 2, Phase 4 added the barcode check).
- The full server run occasionally dies with `Error: Channel closed` during the migration-upgrade test. That is the test runner, not a failing test; a rerun passes.

### Reconciliation baseline (copy of live data, 24 Oct 2026)
Two known differences, both explained. Compare future runs against these:
1. **20 Sep:** the drawer closed at AED 1,230 and reopened at AED 100. AED 1,130 left the drawer with no record (or it was test data).
2. **Ledger cash is AED 100 below the drawer.** That is the opening float, because opening a drawer posted no journal before Phase 4.

Phase 4 only fixes movements **from now on**. Both differences above stay in the history. If your accountant agrees, post one manual journal entry to bring 1001 in line with the drawer (and 1002 with the banks if the run shows a gap). After that, every new run should show no gap.

---

## 5. What is still to do

### Round 2, Phases 5–8
See the round 2 plan for details and the decisions each phase needs: draft ownership, tenders and cash control (Phase 5), FIFO costing (6), database rules (7), and CI that fails when database tests are skipped (8).

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
