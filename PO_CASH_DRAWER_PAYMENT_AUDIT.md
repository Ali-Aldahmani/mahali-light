# Purchase Order Cash Drawer and Supplier Payment Audit

Audit date: **23 October 2026**. Repository: `D:/Projects/mahali-light/`. Reviewed working tree based on commit `4b2190368559e3a8e3426adb4048e2dd71b757cf`, including existing uncommitted changes. Those changes were treated as user-owned and left untouched.

## 1. Executive Summary

**Verdict: the supplier-payment integration is not ready for production financial-control sign-off.**

The cash path is implemented and coherent in its simplest case: a cash supplier payment persists a payment, increments PO paid totals, creates a cash-drawer outflow, reduces the stored drawer balance, and posts DR Accounts Payable / CR Cash through one transaction client. In an isolated in-memory execution of the actual services, AED 20 against an AED 57.75 PO changed paid/balance to AED 20/AED 37.75, changed drawer cash from AED 100 to AED 80, and created one PO-linked cash-out. A second AED 37.75 payment settled the PO and created a separate movement.

The design nevertheless has material control failures:

- There is one store-wide drawer and one latest open drawer session. Payments do not identify a terminal, physical till, or cashier assignment.
- A PO-payment user can silently auto-open a closed drawer without `cash.adjust` permission and record the payment in that synthetic session.
- Retrying a partial payment applies it again and deducts drawer cash again; no idempotency key exists.
- Closing trusts the mutable drawer balance instead of independently reconciling opening balance plus transactions. A counted discrepancy rewrites drawer cash without a corresponding journal entry, so the drawer and GL cash account can diverge.
- Bank payments can use a default account without saving which account funded the payment; a later reversal can credit a different bank.
- Cheques mark the PO paid while posting neither treasury movement nor AP journal settlement. Card and “other” funding methods are not supported.
- Payment reversal physically deletes the payment and attributes journal/treasury reversals to the original payer rather than the reversing user.
- Activity logging is post-commit, best-effort, and lacks structured funding/drawer/session/movement references.

### Evidence and execution limits

This was a read-only source, migration, existing-test and UI trace. Eight isolated checks executed actual `supplierPaymentService`, `cashService`, and the actual PostgreSQL transaction wrapper with a fake `pg.Pool` and in-memory SQL model: **5 PASS, 3 FAIL**. Journal posting was captured at the service boundary; it was not persisted in PostgreSQL. The first two harness attempts were discarded because their VM lacked required `process.env` and pool event stubs; no product conclusions use those invalid runs.

No real database, Docker container, browser, LAN terminal, physical cash drawer, WebSocket connection, or production request was accessed. Actual PostgreSQL lock contention, rollback durability, migration deployment, drawer counts, bank balances and latency are **NOT TESTED**. A source-supported expectation is not reported as a live-system PASS.

### Read-only compliance

No application code, database record/schema, package, Docker configuration or service was modified. No payment or drawer transaction was sent to the application. The harness ran from standard input and wrote no file. The only file created is this report.

## 2. Discovered Financial Architecture

| Area | Discovered implementation |
|---|---|
| Frontend | Next.js 15/React 18. PO detail opens `AddPaymentSlideOver`, which calls the supplier payment service and waits for its response. [web/components/purchases/AddPaymentSlideOver.tsx:35](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:35>), [web/services/supplierPaymentService.ts:1](<D:/Projects/mahali-light/web/services/supplierPaymentService.ts:1>) |
| Backend | Node.js/Express, Zod validation and raw `pg` SQL. No ORM is used in this payment path. [server/controllers/supplierPaymentsController.js:1](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:1>), [server/db/postgres.js:1](<D:/Projects/mahali-light/server/db/postgres.js:1>) |
| Database | PostgreSQL 16 declared by Docker Compose. Runtime deployment/version was not inspected. [docker-compose.yml:9](<D:/Projects/mahali-light/docker-compose.yml:9>) |
| Payment record | `supplier_payments`: PO, supplier, amount, method, optional bank ID, payment date, user, receipt, notes, created_at. [server/db/migrations/004_suppliers.sql:54](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:54>) |
| PO balance | `purchase_orders.amount_paid`, `balance_due`, `payment_status` are incrementally updated. [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>) |
| Cash | Singleton `cash_drawer.current_balance`, drawer sessions, append-style transaction rows with before/after balances. [server/db/migrations/010_treasury.sql:3](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:3>), [server/db/migrations/010_treasury.sql:18](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:18>), [server/db/migrations/010_treasury.sql:34](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:34>), [server/db/migrations/033_cash_drawer_singleton.sql:21](<D:/Projects/mahali-light/server/db/migrations/033_cash_drawer_singleton.sql:21>) |
| Bank | `bank_accounts.current_balance` and `bank_transactions`; default active account may be selected server-side. [server/db/migrations/010_treasury.sql:53](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:53>), [server/db/migrations/010_treasury.sql:70](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:70>), [server/services/bankService.js:76](<D:/Projects/mahali-light/server/services/bankService.js:76>) |
| Ledger | Double-entry journal entries/lines; PO receipt debits Inventory/Input VAT and credits AP, supplier payment debits AP and credits Cash/Bank. [server/services/journalService.js:590](<D:/Projects/mahali-light/server/services/journalService.js:590>), [server/services/journalService.js:625](<D:/Projects/mahali-light/server/services/journalService.js:625>) |
| Treasury views | Summary combines live drawer/bank balances, PO balance_due payables and cash/bank transaction feeds. [server/controllers/treasuryController.js:8](<D:/Projects/mahali-light/server/controllers/treasuryController.js:8>) |
| Reports | Balance sheet derives cash/bank/AP from journal lines; cash-flow operating payments derive from drawer/bank transaction ledgers. [server/services/financialReportService.js:202](<D:/Projects/mahali-light/server/services/financialReportService.js:202>), [server/services/financialReportService.js:272](<D:/Projects/mahali-light/server/services/financialReportService.js:272>) |
| Transactions | `withTransaction` executes BEGIN/COMMIT/ROLLBACK on one client. Supplier payment passes that client into cash/bank and journal services. [server/db/postgres.js:52](<D:/Projects/mahali-light/server/db/postgres.js:52>), [server/services/supplierPaymentService.js:51](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:51>) |
| Authorization | POST payment requires `supplier.purchase_order.pay`; it does not additionally require `cash.adjust` or `bank.transact` based on method. [server/routes/purchaseOrders.js:44](<D:/Projects/mahali-light/server/routes/purchaseOrders.js:44>) |

### Data-flow diagram

```text
Add Payment UI
  └─ POST /api/purchase-orders/:poId/payments
       ├─ authenticate + require supplier.purchase_order.pay
       ├─ lock purchase_orders row
       ├─ insert supplier_payments
       ├─ update PO paid / balance / status
       ├─ method=cash
       │    ├─ lock singleton cash_drawer
       │    ├─ choose latest global open session or auto-open one
       │    ├─ insert cash_drawer_transactions (out)
       │    └─ update cash_drawer.current_balance
       ├─ method=bank_transfer
       │    ├─ lock explicit/default bank
       │    ├─ insert bank_transactions (out)
       │    └─ update bank_accounts.current_balance
       ├─ method=cheque
       │    └─ no treasury or journal posting
       ├─ cash/bank: journal DR AP / CR Cash or Bank
       └─ COMMIT
            ├─ best-effort activity_log
            ├─ ephemeral Socket.IO events
            └─ post-commit SELECT + HTTP response
```

## 3. Add Payment Backend Flow

The UI supports `cash`, `bank_transfer`, and `cheque`; it defaults to cash and submits amount, method, business date and notes. It does not submit a cash drawer/session ID or a bank account ID. [web/components/purchases/AddPaymentSlideOver.tsx:14](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:14>), [web/components/purchases/AddPaymentSlideOver.tsx:44](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:44>), [web/components/purchases/AddPaymentSlideOver.tsx:77](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:77>).

The backend repeats positive-amount/method validation and binds the recording user from authenticated `req.user.id`, ignoring any client actor. [server/controllers/supplierPaymentsController.js:15](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:15>), [server/controllers/supplierPaymentsController.js:65](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:65>). The service locks the PO, rejects cancelled POs and overpayments, inserts the payment, updates header totals, routes treasury by method and posts the journal within one transaction. [server/services/supplierPaymentService.js:51](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:51>), [server/services/supplierPaymentService.js:63](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:63>), [server/services/supplierPaymentService.js:75](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:75>), [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>), [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>), [server/services/supplierPaymentService.js:122](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:122>).

Payment history returns current username, method, business date and server `created_at`; the UI displays date, amount, method, PO number and username but omits the created time, notes, bank/drawer/session, cash movement and journal references. [server/controllers/supplierPaymentsController.js:23](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:23>), [web/components/ui/PaymentHistoryTable.tsx:25](<D:/Projects/mahali-light/web/components/ui/PaymentHistoryTable.tsx:25>).

### F01 — Funding permission is not enforced by payment method

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** The route checks only supplier.purchase_order.pay ([server/routes/purchaseOrders.js:46](<D:/Projects/mahali-light/server/routes/purchaseOrders.js:46>)). Cash drawer mutation routes independently require cash.adjust and bank mutation routes use bank permissions, but addPayment directly invokes cash/bank services ([server/services/supplierPaymentService.js:125](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:125>), [server/services/supplierPaymentService.js:135](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:135>)). The default Manager has all three permissions, but custom roles can hold PO-pay alone ([shared/permissions.js:145](<D:/Projects/mahali-light/shared/permissions.js:145>)).
- **Financial impact:** A role allowed to record supplier payments can withdraw physical drawer cash or a bank balance without the corresponding treasury authority. The audit trail records the user, but authorization boundaries are bypassed.
- **Recommended correction (not implemented):** Map each funding method to a distinct permission and eligible source policy at the backend service boundary. Require explicit authorization for auto/opening or forbid it during supplier payment.
- **Verification method:** Create synthetic roles with only PO-pay, only cash-adjust and only bank-transact in an isolated environment. Attempt each method and assert funding-source authorization before any payment row or balance mutation.


### F02 — A paid draft remains mutable and can break supplier/AP consistency

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Payment rejects only cancelled status ([server/services/supplierPaymentService.js:63](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:63>)), so draft payments are allowed. PO draft update can replace supplier/items, while total recalculation sets balance = total − amount_paid without rejecting a negative balance or recomputing payment status ([server/controllers/purchaseOrdersController.js:378](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:378>), [server/services/purchaseOrderService.js:58](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:58>)).
- **Financial impact:** A draft can be paid before receipt recognizes AP, then moved to another supplier or reduced below the paid amount. PO, supplier payment, AP and supplier statements can disagree.
- **Recommended correction (not implemented):** Define supplier prepayments explicitly with a supplier-advance account, or restrict payments to approved/received states. Lock financial fields after payment or implement an audited amendment workflow.
- **Verification method:** Pay a draft in a disposable DB, change supplier and reduce total below paid. Require rejection or reconciled adjustment; compare PO, supplier payment, AP/advance and reports.


## 4. Cash Drawer Deduction Findings

For `cash`, supplier payment calls `recordCashOut` with transaction type `supplier_payment`, amount, PO reference, actor and the shared transaction client. [server/services/supplierPaymentService.js:125](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:125>). The cash service locks the singleton drawer, selects the newest open session, calculates `after = before - amount`, rejects negative cash, inserts a transaction with before/after/session/actor/PO reference, then updates `current_balance`. [server/services/cashService.js:47](<D:/Projects/mahali-light/server/services/cashService.js:47>), [server/services/cashService.js:65](<D:/Projects/mahali-light/server/services/cashService.js:65>), [server/services/cashService.js:238](<D:/Projects/mahali-light/server/services/cashService.js:238>), [server/services/cashService.js:242](<D:/Projects/mahali-light/server/services/cashService.js:242>), [server/services/cashService.js:252](<D:/Projects/mahali-light/server/services/cashService.js:252>), [server/services/cashService.js:274](<D:/Projects/mahali-light/server/services/cashService.js:274>).

C01 isolated result:

| Record | Before | After / inserted |
|---|---:|---:|
| PO amount_paid | 0.00 | 20.00 |
| PO balance_due | 57.75 | 37.75 |
| Drawer current_balance | 100.00 | 80.00 |
| Cash movement | none | one `supplier_payment/out`, AED 20, session1, PO reference, payer |
| Journal intent | none | one supplier-payment posting call |

This is an in-memory service result, not live database evidence.

### F03 — One global drawer cannot identify the correct physical till or terminal

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Migration 033 enforces exactly one cash_drawer row ([server/db/migrations/033_cash_drawer_singleton.sql:21](<D:/Projects/mahali-light/server/db/migrations/033_cash_drawer_singleton.sql:21>)). Payment payload has no drawer, session or terminal identifier ([server/controllers/supplierPaymentsController.js:15](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:15>)), and cash service always locks the singleton row and uses its latest open session ([server/services/cashService.js:47](<D:/Projects/mahali-light/server/services/cashService.js:47>), [server/services/cashService.js:65](<D:/Projects/mahali-light/server/services/cashService.js:65>)). C08 attached manager B's payment to a session opened by cashier A.
- **Financial impact:** On multiple LAN terminals, all cash sales, refunds and supplier payouts share one running balance/session. The system cannot prove which physical till supplied a payout or reconcile each cashier/terminal independently.
- **Recommended correction (not implemented):** Decide whether the business truly has one shared physical drawer. If tills are separate, model drawer/terminal assignments and cashier sessions, require an authorized active assignment, and include drawer/session IDs in payment and audit records.
- **Verification method:** Open two terminal/cashier sessions in an isolated deployment and attempt payouts from each. Reconcile each physical float independently and verify cross-terminal spending is rejected.


### F04 — Closed drawers are silently auto-opened by supplier payments

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** [server/services/cashService.js:205](<D:/Projects/mahali-light/server/services/cashService.js:205>) explicitly states business flows must not fail when a drawer is closed. With default allowAutoOpen, the service inserts a session, sets the drawer open and continues ([server/services/cashService.js:209](<D:/Projects/mahali-light/server/services/cashService.js:209>)). Supplier payment does not override that default ([server/services/supplierPaymentService.js:125](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:125>)). C03 failed because the closed drawer auto-opened; C04 showed that session opened_by becomes the payment actor.
- **Financial impact:** A manager can record a payout into a session nobody counted or explicitly opened. Opening float is copied from the last stored balance, so physical cash custody and session boundaries are not established.
- **Recommended correction (not implemented):** Require an explicitly open, eligible drawer session for cash payouts. If emergency auto-open is required, use a separately authorized workflow with physical count, reason and high-visibility audit event.
- **Verification method:** Close the drawer in a sandbox, attempt cash payment with PO-pay only and assert a 409 with zero payment/cash/journal effects. Then explicitly open/count and retry successfully.


The cash history API returns direction, amount, before/after, session, PO reference, actor and timestamp. The Cash Drawer table displays timestamp, type, direction/amount, balance after, reference **type** and username; it does not display the PO number/reference ID. [server/controllers/cashDrawerController.js:124](<D:/Projects/mahali-light/server/controllers/cashDrawerController.js:124>), [web/components/treasury/tabs/CashDrawerTab.tsx:215](<D:/Projects/mahali-light/web/components/treasury/tabs/CashDrawerTab.tsx:215>). Classification: data is stored and returned, but linkage is incompletely displayed.

## 5. Payment Method Routing

| UI/backend method | Treasury source | Physical drawer affected? | Ledger action | Assessment |
|---|---|---|---|---|
| cash | Singleton cash drawer, latest global session or auto-opened session | YES, outflow | DR AP / CR Cash (1001) | Implemented; source-selection/control gaps F01/F03/F04 |
| bank_transfer | Explicit bankAccountId if supplied, otherwise default/first active bank | NO | DR AP / CR Bank (1002) | Implemented; UI supplies no bank ID and persistence/reversal defect F05 |
| cheque | No treasury source | NO | No journal entry | PO/payment marked paid immediately: F06 |
| card | Not offered; backend enum rejects | No transaction can be recorded | None | **Not implemented** |
| other | Not offered; backend enum rejects | No transaction can be recorded | None | **Not implemented** |
| cash from treasury vs drawer | No separate choice | Always the singleton drawer | Cash account | **Not distinguishable** |

Backend enforcement is real: controller Zod enum and service allowlist both accept only cash/bank_transfer/cheque. [server/controllers/supplierPaymentsController.js:15](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:15>), [server/services/supplierPaymentService.js:8](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:8>). The backend controls routing from the accepted method; a client cannot label a bank transfer as cash while invoking the bank branch without changing the method itself.

### F05 — Actual bank funding account is not reliably persisted

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** The UI sends no bankAccountId ([web/components/purchases/AddPaymentSlideOver.tsx:77](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:77>)). The service inserts that null value into supplier_payments, then bankService resolves a default account ([server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>), [server/services/bankService.js:91](<D:/Projects/mahali-light/server/services/bankService.js:91>)). The resolved account ID is returned from the bank movement but never written back to the payment. Reversal passes the original nullable field, resolving whichever account is default then ([server/services/supplierPaymentService.js:261](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:261>)). The prior isolated model in the broader PO audit reproduced debit from bank A and reversal credit to bank B after the default changed.
- **Financial impact:** The payment history cannot identify its actual bank. A reversal may restore money to a different bank, corrupting individual bank balances even though aggregate cash may net to zero.
- **Recommended correction (not implemented):** Resolve and persist the actual bank ID before payment insertion; add the missing FK; link payment to original bank transaction and reverse that exact transaction/account.
- **Verification method:** Pay without explicit bank ID, change the default, then reverse in a sandbox. Assert payment, original transaction and reversal all reference the same account and both account balances reconcile.


### F06 — Cheque marks the PO paid without treasury or AP settlement

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** All methods insert a supplier payment and update PO totals ([server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>), [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>)), but only cash/bank enter treasury and journal branches ([server/services/supplierPaymentService.js:122](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:122>), [server/services/supplierPaymentService.js:149](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:149>)). No cheque issued/cleared/bounced lifecycle was found.
- **Financial impact:** A PO can display Paid and supplier outstanding can fall while the AP general ledger remains payable. No funding/clearing evidence exists.
- **Recommended correction (not implemented):** Model cheque issuance, clearing and bounce/reversal with a cheque clearing liability/asset policy, or disable cheque until settlement is supported.
- **Verification method:** Record, clear, bounce and reverse a cheque in a disposable environment. Reconcile PO balance, supplier statement, AP, cheque clearing and bank at every state.


## 6. Cash Drawer Reconciliation

The drawer stores a running `current_balance`; it is not calculated on every read. Each normal transaction also records before/after values. Closing uses current_balance as expected cash, compares the user's count, records a zero-amount closing row, saves expected/count/discrepancy on the session and replaces current_balance with the counted amount. [server/db/migrations/010_treasury.sql:6](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:6>), [server/services/cashService.js:446](<D:/Projects/mahali-light/server/services/cashService.js:446>), [server/services/cashService.js:474](<D:/Projects/mahali-light/server/services/cashService.js:474>), [server/services/cashService.js:489](<D:/Projects/mahali-light/server/services/cashService.js:489>), [server/services/cashService.js:502](<D:/Projects/mahali-light/server/services/cashService.js:502>).

Session summary independently aggregates transaction amounts by direction/type and includes `supplier_payment:out`; the reconciliation UI displays Supplier payments under cash out. [server/services/cashService.js:605](<D:/Projects/mahali-light/server/services/cashService.js:605>), [web/components/treasury/tabs/ReconciliationSummary.tsx:15](<D:/Projects/mahali-light/web/components/treasury/tabs/ReconciliationSummary.tsx:15>). Thus ordinary supplier payouts are included in the displayed session totals and in the running expected balance.

### F07 — Drawer closing does not independently reconcile the ledger and can diverge from GL cash

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Close explicitly trusts cash_drawer.current_balance ([server/services/cashService.js:446](<D:/Projects/mahali-light/server/services/cashService.js:446>)) instead of recomputing opening + session transactions. It then sets current_balance to counted cash ([server/services/cashService.js:502](<D:/Projects/mahali-light/server/services/cashService.js:502>)). The zero-amount closing transaction jumps balance_after to counted ([server/services/cashService.js:474](<D:/Projects/mahali-light/server/services/cashService.js:474>)), but closeDrawer creates no journal entry. Balance-sheet cash is calculated from journal account 1001 ([server/services/financialReportService.js:219](<D:/Projects/mahali-light/server/services/financialReportService.js:219>)), while Treasury displays drawer.current_balance ([server/controllers/treasuryController.js:31](<D:/Projects/mahali-light/server/controllers/treasuryController.js:31>)).
- **Financial impact:** Any stale running balance goes undetected. An accepted cash discrepancy changes Treasury cash without changing GL cash, so balance sheet, drawer and physical count can disagree indefinitely.
- **Recommended correction (not implemented):** Recompute and compare session expected cash from immutable transactions during close. Post an approved cash-over/short journal entry for counted discrepancies and retain a linked adjustment movement; block close on unexplained ledger mismatch.
- **Verification method:** Seed opening cash, sales, refunds and supplier payouts in a disposable DB; tamper only with current_balance to ensure close detects it. Close with an approved discrepancy and reconcile physical cash, transaction sum, drawer balance and GL 1001.


### F08 — Open-session uniqueness and cash arithmetic are not database-enforced

- **Severity:** MEDIUM. **Confidence:** CODE-SUPPORTED RISK.
- **Evidence:** cash_drawer is singleton, but migrations define no unique partial constraint limiting sessions with status=open and no CHECK constraints for direction, positive amount, before/after arithmetic or status values ([server/db/migrations/010_treasury.sql:18](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:18>), [server/db/migrations/010_treasury.sql:34](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:34>)). Service serialization through the drawer lock protects normal writers, but direct/import/future paths can violate invariants.
- **Financial impact:** Multiple open sessions or malformed movements could make attribution and reconciliation ambiguous even if current application paths behave.
- **Recommended correction (not implemented):** Add database constraints compatible with approved correction entries, plus a unique open-session invariant. Reconcile existing records before migration.
- **Verification method:** On a disposable migrated DB, attempt two open sessions and invalid direction/amount/balance rows; all must fail while valid opening/closing/zero closing anchors remain supported.


The discrepancy threshold is AED 10. The same `cash.adjust` user can resubmit `force=true`; no second approver is required. [server/services/cashService.js:452](<D:/Projects/mahali-light/server/services/cashService.js:452>), [server/controllers/cashDrawerController.js:50](<D:/Projects/mahali-light/server/controllers/cashDrawerController.js:50>). **Severity MEDIUM, confidence CONFIRMED:** UI calls this a manager override, and default roles limit cash.adjust to Manager/Admin, but custom roles or the same manager can self-approve. Recommend explicit policy, reason and optional four-eyes approval for material discrepancies; verify actor/approver separation and audit metadata.

## 7. Treasury and Accounting Integration

For a received PO, accounting is conceptually correct:

1. Receipt: DR Inventory (1004), DR Input VAT (2002), CR Accounts Payable (2001). [server/services/journalService.js:590](<D:/Projects/mahali-light/server/services/journalService.js:590>)
2. Cash settlement: DR Accounts Payable (2001), CR Cash (1001). [server/services/journalService.js:625](<D:/Projects/mahali-light/server/services/journalService.js:625>)
3. Bank settlement: DR Accounts Payable (2001), CR Bank (1002).

The payment is therefore a liability settlement, not a second purchase expense. No expense account is posted by `postSupplierPaymentEntry`. This avoids duplicate P&L expense in the core GL path. The integration test source checks a fully received bank-funded PO clears AP, but that environment-gated test was inspected and not run in this audit. [tests/integration/purchaseVat.test.js:153](<D:/Projects/mahali-light/tests/integration/purchaseVat.test.js:153>).

Treasury classifies cash/bank supplier payments as outgoing movements; its summary includes them in today's money out/recent activity, and the cash-flow statement reports them under paidToSuppliers. [server/controllers/treasuryController.js:35](<D:/Projects/mahali-light/server/controllers/treasuryController.js:35>), [server/services/financialReportService.js:313](<D:/Projects/mahali-light/server/services/financialReportService.js:313>). PO `balance_due` drives Treasury's live supplier-payables card, while balance sheet AP uses journals. That dual authority can disagree for cheque, paid drafts, failed/incomplete historical data, or drawer/GL discrepancies.

The custom monthly summary labels the sum of `supplier_payments` as “All Suppliers Purchase” and adds it to “paid from showroom.” [server/services/reportService.js:2203](<D:/Projects/mahali-light/server/services/reportService.js:2203>), [server/services/reportService.js:2241](<D:/Projects/mahali-light/server/services/reportService.js:2241>). This is a cash-paid summary, not accrual purchase cost; the label can be mistaken for inventory purchases/expense. **Severity MEDIUM, confidence CONFIRMED.** Financial impact: users may compare a payment-period cash total with receipt-period purchase cost and infer incorrect profitability. Recommended correction: label it “Supplier payments” and keep accrual purchase/cost reporting distinct. Verify a PO received in one month and paid in another appears in the appropriate receipt/payment reports without duplicate P&L effect.

### F09 — Payment and treasury movement lack a durable direct cross-reference

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** Cash/bank movements use reference_type=purchase_order and reference_id=PO ID ([server/services/supplierPaymentService.js:125](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:125>), [server/services/supplierPaymentService.js:135](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:135>)), while journals reference supplier_payment/payment ID ([server/services/journalService.js:637](<D:/Projects/mahali-light/server/services/journalService.js:637>)). supplier_payments stores neither cash movement ID nor drawer/session ID ([server/db/migrations/004_suppliers.sql:54](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:54>)). Multiple partial payments for one PO therefore share the same treasury reference.
- **Financial impact:** An auditor cannot deterministically join one payment row to one cash/bank movement without amount/time inference. Reversals and duplicate investigations are harder, especially for equal partial payments.
- **Recommended correction (not implemented):** Persist the resolved funding source and treasury transaction ID on an immutable payment/funding allocation record; use payment ID as the movement reference and retain PO as a relational field or structured metadata.
- **Verification method:** Record two equal cash payments seconds apart. Starting from each payment ID, resolve exactly one movement and journal without matching on amount/time; reverse one and prove only its funding record is affected.


### F10 — Payment reversal destroys evidence and uses the wrong accounting actor

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** deletePayment physically deletes supplier_payments ([server/services/supplierPaymentService.js:211](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:211>)), then adds opposite PO/treasury/journal effects. It accepts no reversing user and passes pm.employee_id—the original payer—to journal and treasury reversals ([server/services/supplierPaymentService.js:179](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:179>), [server/services/supplierPaymentService.js:241](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:241>), [server/services/supplierPaymentService.js:251](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:251>)). The controller's separate activity event uses the current user correctly ([server/controllers/supplierPaymentsController.js:164](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:164>)), creating conflicting actor records.
- **Financial impact:** Original payment/receipt evidence disappears, movement/journal references point to a deleted payment, and reversal entries falsely attribute the correction to the payer rather than the person who performed it.
- **Recommended correction (not implemented):** Retain the original payment with reversed status. Insert a linked reversal containing current authenticated actor, time, reason, original treasury transaction/account and immutable receipt evidence.
- **Verification method:** Have user A pay and user B reverse. Assert both records survive, all reversal funding/journal entries identify B, original funding is restored exactly, and the audit chain is navigable in both directions.


### F11 — Payment business date and treasury date can disagree

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** Payment and journal use selected payment_date ([server/services/supplierPaymentService.js:95](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:95>), [server/services/supplierPaymentService.js:157](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:157>)). Cash movements have only server timestamp; bankService defaults transaction_date to today because addPayment supplies no transactionDate ([server/services/supplierPaymentService.js:135](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:135>), [server/services/bankService.js:163](<D:/Projects/mahali-light/server/services/bankService.js:163>)).
- **Financial impact:** A backdated bank supplier payment appears on one day in payment/AP reports and another day in bank/treasury reports. Cash flow groups cash by timestamp date and bank by transaction timestamp in the financial service, further separating business-date semantics.
- **Recommended correction (not implemented):** Define an approved business/settlement date and pass it consistently to payment, treasury and journal while retaining server recorded_at separately. For cash, add an explicit business date only if policy allows backdating physical payouts.
- **Verification method:** Record an allowed backdated cash and bank payment around store midnight. Compare supplier report, drawer/bank ledger, journal, cash flow and audit dates in Asia/Dubai.


## 8. Payment Calculation Accuracy

The service rounds currency to two decimals, locks the PO, checks the current remaining balance, and updates:

```text
newPaid    = round(alreadyPaid + payment)
newBalance = round(totalCost - newPaid)
status     = paid when balance <= 0.0001, partial when paid > 0, otherwise unpaid
```

Evidence: [server/services/supplierPaymentService.js:10](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:10>), [server/services/supplierPaymentService.js:51](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:51>), [server/services/supplierPaymentService.js:71](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:71>), [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>).

Executed isolated results:

| Step | PO paid | PO balance | Status | Drawer | Cash movements |
|---|---:|---:|---|---:|---:|
| Opening fixture | 0.00 | 57.75 | unpaid | 100.00 | 0 |
| Cash payment 20.00 | 20.00 | 37.75 | partial | 80.00 | 1 |
| Cash payment 37.75 | 57.75 | 0.00 | paid | 42.25 | 2 |

C01 and C02 passed at the in-memory service boundary. C05 showed insufficient AED 10 drawer cash rejects an AED 20 payout and restores payment/PO/drawer/movement state in the fake transaction model.

Limits:

- The header is incremented rather than recalculated from retained payment rows.
- Duplicate partial payments are both valid while remaining balance permits (F12).
- Cash/bank settlement is permitted before goods receipt/AP recognition (F02).
- Cheque changes header totals without GL settlement (F06).
- The calculation uses JavaScript Number plus rounding, not an exact decimal library; the specific AED examples pass, but exhaustive edge precision is not tested.

## 9. Concurrency and Double-Payment Risks

The PO row `FOR UPDATE` serializes payments to the same PO. The cash drawer row `FOR UPDATE` serializes all drawer transactions across the store; bank account rows are similarly locked. [server/services/supplierPaymentService.js:53](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:53>), [server/services/cashService.js:49](<D:/Projects/mahali-light/server/services/cashService.js:49>), [server/services/bankService.js:79](<D:/Projects/mahali-light/server/services/bankService.js:79>). Source-supported expectation: two distinct payments that together exceed the balance cannot both commit after the second rechecks the locked PO. Actual concurrent PostgreSQL execution was not performed.

Two different POs paying cash lock their own PO first and then the singleton drawer. The drawer lock should prevent lost cash updates and insufficient-cash overspend. It also creates a store-wide throughput bottleneck. Closing locks the drawer, so a payment and close should serialize. No terminal-specific session transition exists to protect.

### F12 — Duplicate/retried partial payments deduct twice

- **Severity:** CRITICAL. **Confidence:** CONFIRMED.
- **Evidence:** There is no idempotency key in the UI payload/schema/service or a unique operation constraint ([web/components/purchases/AddPaymentSlideOver.tsx:77](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:77>), [server/controllers/supplierPaymentsController.js:15](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:15>), [server/db/migrations/004_suppliers.sql:54](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:54>)). The HTTP timeout action can replay the original request ([web/services/http.ts:45](<D:/Projects/mahali-light/web/services/http.ts:45>)). C07 submitted the same AED 20 partial payment twice: two payment rows, paid=40, drawer=60, two cash movements instead of one/20/80/one.
- **Financial impact:** A double-click race, browser retry, response loss or user retry can pay the supplier twice and remove physical cash twice while both payments remain below outstanding balance.
- **Recommended correction (not implemented):** Require a caller-stable idempotency key, unique operation record and payload hash in the same transaction. Return the original committed result for retries. Keep UI loading protection but do not treat it as the financial control.
- **Verification method:** Submit the same key sequentially and concurrently; drop the response after commit and retry. Assert one payment, one treasury movement, one journal and the identical response. A new key must allow a legitimate second partial payment.


The button's loading state disables ordinary clicks after React updates ([web/components/purchases/AddPaymentSlideOver.tsx:112](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:112>)), but cannot handle duplicated network requests or a second terminal.

| Concurrency/failure scenario | Assessment |
|---|---|
| Two cashiers pay same PO | PO lock should serialize; actual DB race NOT TESTED. Both distinct affordable payments commit. |
| Two payments exceed remaining total | Second should reject after lock; NOT TESTED against PostgreSQL. |
| Same partial request repeated | Reproduced double deduction (C07 FAIL). |
| Payment committed, response lost | Retry can duplicate; post-commit controller SELECT can report failure after commit ([server/controllers/supplierPaymentsController.js:131](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:131>)). |
| Drawer closes during payment | Drawer lock should serialize. Auto-open means a payment after close silently starts another session (F04). |
| Session changes | Single drawer lock serializes service-managed changes, but payout does not require same user/terminal (F03). |
| Insufficient cash | Service rejects negative drawer; C05 passed in fake transaction model. |
| Payment write succeeds, cash/journal fails | Shared transaction should roll back; C06 observed wrapper ROLLBACK and fake state restoration. Real PostgreSQL NOT TESTED. |
| Cash movement succeeds, PO fails | Same transaction client; source expects rollback. Real interruption/crash NOT TESTED. |
| Docker/backend interruption | PostgreSQL transaction should commit or roll back; response ambiguity and retry remain. NOT TESTED. |
| Two terminals spend same drawer | Drawer row lock should serialize genuine writes; global drawer attribution and duplicate intent remain unsafe. |
| Deadlock | Same-PO payment locks PO then drawer; other workflows may lock resources in different orders. Full lock graph/live deadlocks NOT TESTED. |
| Pool pressure | Pool max defaults to 10; one global drawer serializes cash mutations. 5/10/20/50 terminal performance NOT TESTED. [server/db/postgres.js:8](<D:/Projects/mahali-light/server/db/postgres.js:8>) |

## 10. Audit Log and User Attribution

Persisted evidence by layer:

| Evidence | Stored | Gaps |
|---|---|---|
| Supplier payment | ID, PO, supplier, amount, method, optional bank ID, business date, user ID, receipt, notes, server created_at | No drawer/session/terminal, resolved default bank, treasury movement, journal ID, idempotency key or reversal status/link |
| Cash movement | ID, drawer, session, type, direction, amount, before/after, PO reference, user, timestamp, notes | No supplier-payment ID or PO FK; hard-deleting drawer cascades movement |
| Bank movement | ID, account, type/direction/amount, before/after, PO reference, user, dates/timestamp | No supplier-payment ID; resolved account not copied to payment |
| Journal | Entry/line IDs, payment reference, date, creator, DR/CR accounts/amounts | Reversal actor defect; journal references deleted payment after reversal |
| Activity log | payment ID, action, current user, timestamp, textual amount/method/PO | Best-effort, no funding source/session/movement IDs or structured before/after |
| PO | paid, balance, status | Current state only, no revision history |

### F13 — Activity audit is post-commit, optional and financially incomplete

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Controller logs after addPayment returns/commits ([server/controllers/supplierPaymentsController.js:70](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:70>), [server/controllers/supplierPaymentsController.js:80](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:80>)). logActivity catches INSERT failures and resolves ([server/utils/activityLog.js:12](<D:/Projects/mahali-light/server/utils/activityLog.js:12>)). Payment event writes amount/method/PO only in free-text notes and no old/new values, drawer/session/account or treasury/journal references ([server/controllers/supplierPaymentsController.js:80](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:80>)).
- **Financial impact:** A financially successful payout may have no activity event. Even when present, the event cannot prove which funding account/session moved or reconstruct balances.
- **Recommended correction (not implemented):** Persist an immutable structured audit/outbox row within the financial transaction, containing operation/payment/PO/supplier, actor, recorded/business time, method, resolved source, movement/journal IDs and before/after values.
- **Verification method:** Force audit insertion failure in a disposable DB and require business rollback or a durable transactional outbox row. Reconstruct one payment and reversal entirely from audit links.


Normal user soft deletion sets users/employees inactive rather than deleting rows; joins do not filter inactive users, so IDs/current usernames remain visible. [server/controllers/usersController.js:285](<D:/Projects/mahali-light/server/controllers/usersController.js:285>), [server/controllers/supplierPaymentsController.js:42](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:42>). However FKs use `ON DELETE SET NULL` and no event-time name snapshot exists ([server/db/migrations/004_suppliers.sql:62](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:62>), [server/db/migrations/010_treasury.sql:48](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:48>)). Therefore:

- Normal soft-delete preservation: **code-supported YES; runtime NOT TESTED**.
- Hard deletion or renamed username: historical actor ID/name can be lost or changed.
- Reversal actor: incorrect even before deletion (F10).

**Severity MEDIUM, confidence CONFIRMED** for long-term identity limitation. Recommended correction: prohibit hard deletion of referenced financial actors and retain immutable stable identity/event-time display data. Verify soft-delete, rename and attempted hard-delete with synthetic users in a disposable DB.

## 11. Frontend/Backend Consistency

Classification: **A** correctly stored/displayed; **B** stored but not displayed; **C** displayed without complete persistence; **D** incorrectly calculated/routed; **E** not implemented. “Displayed” is established from component mapping, not an executed browser.

| Screen/field | Class | Evidence |
|---|---|---|
| PO payment amount/method/business date/current username | A | Returned by API and rendered in PaymentHistoryTable. [server/controllers/supplierPaymentsController.js:23](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:23>), [web/components/ui/PaymentHistoryTable.tsx:25](<D:/Projects/mahali-light/web/components/ui/PaymentHistoryTable.tsx:25>) |
| Payment recording time | B | createdAt returned but table shows paymentDate only. |
| Payment notes/reference | B / E structured | Notes stored/returned, not rendered; dedicated reference/cheque field absent. |
| Payment funding drawer/session | E on payment | Exists only on separate cash movement, not payment/API table. |
| Actual default bank | D | Actual bank movement exists but supplier payment bankAccountId remains null (F05). |
| Payment reversal | D | UI says Reverse, but backend deletes payment and loses original history (F10). |
| Cash drawer amount/type/direction/balance/user/time | A | Drawer API/table expose these. [web/components/treasury/tabs/CashDrawerTab.tsx:215](<D:/Projects/mahali-light/web/components/treasury/tabs/CashDrawerTab.tsx:215>) |
| Cash movement PO identity | B | reference ID returned, but table shows only “purchase order,” not PO number/ID. |
| Session supplier-payment totals | A | Aggregated and shown under cash out. [web/components/treasury/tabs/ReconciliationSummary.tsx:153](<D:/Projects/mahali-light/web/components/treasury/tabs/ReconciliationSummary.tsx:153>) |
| Session correct cashier/terminal | D/E | Global session displayed; no cashier assignment/terminal model for payout. |
| Treasury live cash/bank/payables | A with consistency limits | Summary/UI show current values and refetch on treasury events. [web/components/treasury/tabs/OverviewTab.tsx:46](<D:/Projects/mahali-light/web/components/treasury/tabs/OverviewTab.tsx:46>) |
| Balance-sheet cash/AP | A from journal, but may diverge | Uses journal rather than drawer/header; cheque/discrepancy gaps cause divergence. |
| Cash-flow supplier payment | A for cash/bank transaction rows | Aggregated under paidToSuppliers. |
| Card/other funding | E | Not in UI or backend allowlist. |
| Cash-from-treasury separate from physical drawer | E | Cash always routes to singleton drawer. |
| Full structured audit trail | E | No joined payment/funding/journal/audit timeline. |

The payment page listens for `po_payment_added` and reloads; cash/bank events update Treasury views for Manager/Admin. [server/controllers/supplierPaymentsController.js:101](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:101>), [server/controllers/supplierPaymentsController.js:113](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:113>), [web/store/socketStore.ts:353](<D:/Projects/mahali-light/web/store/socketStore.ts:353>). Events are ephemeral and role-room targeted. Payment reversal emits treasury events but no PO payment-reversal event ([server/controllers/supplierPaymentsController.js:172](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:172>)), so another terminal's PO balance can stay stale. **Severity MEDIUM, confidence CONFIRMED.** Recommend emitting/reconciling every payment state change by authorization and fetching a versioned snapshot on reconnect/focus. Verify two terminals across add/reverse/disconnect/reconnect; actual LAN delivery/latency was NOT TESTED.

## 12. Detailed Test Matrix

### Executed isolated checks

Execution boundary: Node v24.15.0; actual service modules and transaction wrapper loaded in a VM; fake PostgreSQL pool/in-memory SQL model; journal posting captured; no real database/network/browser/files. **5 PASS, 3 FAIL.**

PASS means only the named assertion passed at this boundary. C08 is a factual control check—its PASS confirms unsafe global-session behavior, not financial approval. The two discarded harness attempts are excluded because harness initialization failed before application logic.

| Test ID | Expected behavior / assertion | Actual isolated result | Status | Exact code evidence | Severity | Recommended verification |
|---|---|---|---|---|---|---|
| C01 | Cash supplier payment persists payment, PO totals, one drawer outflow and balanced journal intent | Model result: paid 20, balance 37.75, drawer 100→80, one supplier_payment outflow on session1, PO reference and payer retained. | **PASS** | [server/services/supplierPaymentService.js:125](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:125>) | HIGH | Run the same example through isolated HTTP/PostgreSQL and reconcile all persisted rows and GL lines. |
| C02 | Second cash payment settles PO and creates a second retained cash movement | Expected isolated assertion satisfied. | **PASS** | [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>) | HIGH | Record both payments in isolated PostgreSQL and reconcile payment sum, PO, drawer, session and journal. |
| C03 | Closed drawer rejects supplier cash payment instead of silently creating a session | Actual service auto-created a cash session 1 !== 0 | **FAIL** | [server/services/cashService.js:209](<D:/Projects/mahali-light/server/services/cashService.js:209>) | HIGH | Close a sandbox drawer, attempt cash payment and require rejection/no writes. |
| C04 | Auto-opened supplier-payment session is bound to an independently selected active cashier session | Auto-opened session is attributed to payment actor, not an independently authorized cashier/session | **FAIL** | [server/services/cashService.js:218](<D:/Projects/mahali-light/server/services/cashService.js:218>) | HIGH | Require explicit eligible cashier/drawer assignment and verify opening actor/physical count. |
| C05 | Insufficient drawer cash rolls back all supplier-payment effects | Expected isolated assertion satisfied. | **PASS** | [server/services/cashService.js:242](<D:/Projects/mahali-light/server/services/cashService.js:242>) | HIGH | Use actual PostgreSQL; assert insufficient cash leaves no payment, PO, movement or journal changes. |
| C06 | Journal failure rolls back payment, PO and cash movement | Actual transaction wrapper issued rollback; state restoration is the fake model, not PostgreSQL proof. | **PASS** | [server/db/postgres.js:52](<D:/Projects/mahali-light/server/db/postgres.js:52>) | HIGH | Force a real journal constraint/closed-period failure and inspect every table after rollback. |
| C07 | Duplicate partial request is idempotent | Same request applied twice + actual - expected [ + 2, + 40, + 60, + 2 - 1, - 20, - 80, - 1 ] | **FAIL** | [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>) | CRITICAL | Replay one stable idempotency key sequentially/concurrently and after response loss; require one effect. |
| C08 | Cash outflow is attached to currently open global session, regardless of payer | Session belongs to cashierA; transaction actor is managerB. The service performs no same-user/session/terminal check. | **PASS** | [server/services/cashService.js:65](<D:/Projects/mahali-light/server/services/cashService.js:65>) | HIGH | Use two users/terminals and require correct assigned session or rejection. |

### Required real-system verification not executed

| Test ID | Expected behavior | Actual verified here | Status | Evidence | Severity | Safe verification procedure |
|---|---|---|---|---|---|---|
| N01 — PostgreSQL cash payment | Payment/PO/cash movement/drawer/journal commit together | Source + C01 fake model only | NOT TESTED | [server/services/supplierPaymentService.js:51](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:51>), [server/services/cashService.js:252](<D:/Projects/mahali-light/server/services/cashService.js:252>) | HIGH | Use a disposable migrated DB; query all rows before/after and after restart. |
| N02 — Real rollback | Failure at cash/journal step leaves zero partial writes | C05/C06 fake restoration only | NOT TESTED | [server/db/postgres.js:52](<D:/Projects/mahali-light/server/db/postgres.js:52>) | HIGH | Inject insufficient cash and closed-period/journal failure in isolated DB; compare all tables. |
| N03 — Same-PO concurrency | Lock prevents combined payments above outstanding | FOR UPDATE source only | NOT TESTED | [server/services/supplierPaymentService.js:53](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:53>) | HIGH | Barrier-synchronize two connections and inspect one/other outcomes and final totals. |
| N04 — Same-drawer concurrency | No lost balance update or cash overspend | Drawer lock source only | NOT TESTED | [server/services/cashService.js:49](<D:/Projects/mahali-light/server/services/cashService.js:49>), [server/services/cashService.js:242](<D:/Projects/mahali-light/server/services/cashService.js:242>) | HIGH | Pay two POs concurrently against limited cash; reconcile serial order/before-after chain. |
| N05 — Close/payment race | Exactly one session owns payout and close is coherent | Source predicts serialization; auto-reopen risk remains | NOT TESTED | [server/services/cashService.js:428](<D:/Projects/mahali-light/server/services/cashService.js:428>), [server/services/cashService.js:202](<D:/Projects/mahali-light/server/services/cashService.js:202>) | HIGH | Race close with payout, then inspect sessions, count, movements and GL. |
| N06 — Backend/Docker interruption | Transaction durable or rolled back, retry exactly once | No service/process interruption | NOT TESTED | [server/db/postgres.js:55](<D:/Projects/mahali-light/server/db/postgres.js:55>) | CRITICAL | Kill only an isolated backend connection before/after commit; retry using operation ID and reconcile. |
| N07 — Bank payment | Correct selected account only; no drawer movement | Branch source reviewed | NOT TESTED | [server/services/supplierPaymentService.js:135](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:135>) | HIGH | Record with explicit/default bank and inspect bank/drawer/payment/journal. |
| N08 — Bank reversal | Original bank restored and actor/references retained | Prior in-memory model reproduced wrong bank when default changed | NOT TESTED | [server/services/supplierPaymentService.js:261](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:261>) | HIGH | Pay via default A, switch default B, reverse; require only A restored. |
| N09 — Cheque lifecycle | Issued/cleared/bounced states reconcile PO/AP/bank | No lifecycle found | NOT TESTED | [server/services/supplierPaymentService.js:149](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:149>) | HIGH | After implementation, execute all states and reconcile subledger/GL/treasury. |
| N10 — Card payment | Card settlement account used, drawer untouched | Method not implemented | NOT TESTED | [server/controllers/supplierPaymentsController.js:17](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:17>) | MEDIUM | Implement explicit settlement policy first; test authorization, clearing and reversal. |
| N11 — Drawer reconciliation | Opening + inflows − outflows equals expected and GL cash | Source includes supplier outflow but trusts current balance | NOT TESTED | [server/services/cashService.js:446](<D:/Projects/mahali-light/server/services/cashService.js:446>), [server/services/cashService.js:622](<D:/Projects/mahali-light/server/services/cashService.js:622>) | HIGH | Build a full isolated shift: opening, sales, refund, supplier payment, adjustment, count and close. |
| N12 — Cash discrepancy | Approved over/short adjusts drawer and GL consistently | No discrepancy journal exists | NOT TESTED | [server/services/cashService.js:502](<D:/Projects/mahali-light/server/services/cashService.js:502>) | HIGH | Close with short/over and compare drawer, movement ledger, cash-over/short account and GL cash. |
| N13 — Permission routing | PO-pay alone cannot mutate unauthorized cash/bank | Source shows only PO-pay check | NOT TESTED | [server/routes/purchaseOrders.js:46](<D:/Projects/mahali-light/server/routes/purchaseOrders.js:46>) | HIGH | Synthetic least-privilege roles attempt every method; assert pre-write denial. |
| N14 — Soft-deleted actor | Payment/movement/journal remain attributable | Source-supported only | NOT TESTED | [server/db/migrations/004_suppliers.sql:62](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:62>), [server/db/migrations/010_treasury.sql:48](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:48>) | MEDIUM | Record with synthetic user, soft-delete/rename and inspect all APIs/reports. |
| N15 — Audit failure | Financial commit cannot silently lack durable audit | Source shows swallowed post-commit failure | NOT TESTED | [server/utils/activityLog.js:12](<D:/Projects/mahali-light/server/utils/activityLog.js:12>) | HIGH | Force audit store failure in disposable DB; require rollback or durable outbox. |
| N16 — Multi-terminal update | Add/reverse/close converge on all authorized terminals | Socket paths reviewed only | NOT TESTED | [web/store/socketStore.ts:353](<D:/Projects/mahali-light/web/store/socketStore.ts:353>) | MEDIUM | Two isolated browsers with disconnect/reconnect; measure commit-to-render latency. |
| N17 — 5/10/20/50 terminals | Correct balances and acceptable lock/pool latency | No load test | NOT TESTED | [server/db/postgres.js:15](<D:/Projects/mahali-light/server/db/postgres.js:15>), [server/services/cashService.js:49](<D:/Projects/mahali-light/server/services/cashService.js:49>) | MEDIUM | After correctness fixes, run sandbox workloads and report p50/p95/p99, waits/errors and reconciliation. |
| N18 — Running schema/data | Migrations applied; no duplicate sessions/orphans/drift | No database inspection performed | NOT TESTED | [server/db/migrations/010_treasury.sql:18](<D:/Projects/mahali-light/server/db/migrations/010_treasury.sql:18>), [server/db/migrations/033_cash_drawer_singleton.sql:21](<D:/Projects/mahali-light/server/db/migrations/033_cash_drawer_singleton.sql:21>) | HIGH | Authorized read-only catalog/invariant queries against an approved target; invalid writes only on clone. |
| N19 — Report reconciliation | PO/supplier/Treasury/cash flow/balance sheet agree | Query sources mapped only | NOT TESTED | [server/services/financialReportService.js:272](<D:/Projects/mahali-light/server/services/financialReportService.js:272>) | HIGH | Use a known isolated lifecycle across month boundary and reconcile every report to ledgers. |
| N20 — Payment reversal | Original retained, exact funding restored, reverser identified | Source and prior model show failures | NOT TESTED | [server/services/supplierPaymentService.js:179](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:179>) | HIGH | User A pays, user B reverses; verify immutable link, actors, funding, AP and PO. |

### Existing tests inspected, not run

- [tests/integration/purchaseVat.test.js:140](<D:/Projects/mahali-light/tests/integration/purchaseVat.test.js:140>) creates an isolated PostgreSQL database when environment-gated and verifies receipt VAT plus bank-funded AP clearing. It does not validate cash drawer/session selection, idempotency or reversal.
- [tests/contracts/concurrency.locks.test.js:40](<D:/Projects/mahali-light/tests/contracts/concurrency.locks.test.js:40>) is a static contract asserting cash/bank `FOR UPDATE`; it does not run supplier-payment races.
- [tests/contracts/concurrency.live.test.js:1](<D:/Projects/mahali-light/tests/contracts/concurrency.live.test.js:1>) is an opt-in isolated invoice stock race, not a PO supplier-payment/drawer race.
- [tests/integration/invoiceIntegrity.test.js:87](<D:/Projects/mahali-light/tests/integration/invoiceIntegrity.test.js:87>) has cash-balance helpers for invoice behavior, not this supplier payment flow.
- None was marked PASS because none was executed in this audit.

### Harness source and fingerprints

The exact harness is retained below so the boundary and assertions are reviewable. It was piped to Node through standard input. It uses only existing installed modules, blocks unlisted dependencies, and cannot connect to the application/database.

| Source | SHA-256 during execution |
|---|---|
| [server/db/postgres.js:1](<D:/Projects/mahali-light/server/db/postgres.js:1>) | `cb8e66a5eea7c46dacf66a78c577e6962fd7f1a850190d5f7c2d5f0a1dc1665c` |
| [server/services/cashService.js:1](<D:/Projects/mahali-light/server/services/cashService.js:1>) | `325aabf2692c41a7e5e760d299567137dfc2916a1eecb50c9a818c82b466f685` |
| [server/services/supplierPaymentService.js:1](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:1>) | `ca913c33e0a9b7a6905cd96069f9d8916bbdf5915f48a43caba67ef8bbc56ce5` |

<details>
<summary>Executed isolated harness</summary>

```javascript
'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const results=[],hashes={}; const clone=x=>structuredClone(x);
class AppError extends Error{constructor(code,message,opts={}){super(message||code);this.code=code;this.status=opts.status;}}
const errors={AppError,ERROR_CODES:new Proxy({},{get:(_,k)=>k})};
function source(p){const s=fs.readFileSync(p,'utf8');hashes[p]=crypto.createHash('sha256').update(s).digest('hex');return s;}
function load(p,deps){const module={exports:{}};vm.runInNewContext(source(p),{module,exports:module.exports,require:n=>{if(!Object.hasOwn(deps,n))throw Error('BLOCKED '+n);return deps[n]},console,process:{env:{}}},{filename:p,timeout:5000});return module.exports}
async function check(id,name,fn){try{const detail=await fn();results.push({id,name,status:'PASS',detail:detail||'Expected isolated assertion satisfied.'})}catch(e){if(e.message.startsWith('BLOCKED')||e.message.startsWith('UNMODELED'))throw e;results.push({id,name,status:'FAIL',detail:e.message})}}
function env({balance=100,status='open',session=true,journalFail=false}={}){
 let state={drawer:{id:'drawer',name:'Main',current_balance:balance,opening_balance:balance,status,updated_at:'2026-10-23T08:00:00Z'},
 sessions:session?[{id:'session1',cash_drawer_id:'drawer',opened_by:'opener',opening_balance:balance,status:'open',opened_at:'2026-10-23T08:00:00Z'}]:[],
 tx:[],payments:[],po:{id:'po',po_number:'PO-AUDIT',supplier_id:'supplier',status:'confirmed',total_cost:57.75,amount_paid:0,balance_due:57.75,payment_status:'unpaid'},journals:[]};
 let saved=null,released=0;const calls=[];
 async function query(sql,args=[]){const s=sql.replace(/\s+/g,' ').trim();calls.push({sql:s,args:clone(args)});
  if(s==='BEGIN'){saved=clone(state);return {rows:[]}} if(s==='COMMIT'){saved=null;return {rows:[]}} if(s==='ROLLBACK'){state=saved;saved=null;return {rows:[]}}
  const rows=x=>({rows:clone(x),rowCount:x.length});
  if(s.startsWith('SELECT * FROM purchase_orders'))return rows([state.po]);
  if(s.startsWith('SELECT * FROM cash_drawer ORDER BY'))return rows([state.drawer]);
  if(s.startsWith('SELECT * FROM cash_drawer_sessions'))return rows(state.sessions.filter(x=>x.status==='open'));
  if(s.startsWith('INSERT INTO cash_drawer_sessions')){const x={id:'session'+(state.sessions.length+1),cash_drawer_id:'drawer',opened_by:args[1],opening_balance:args[2],status:'open',notes:args[3],opened_at:'2026-10-23T08:01:00Z'};state.sessions.push(x);return rows([x])}
  if(s.startsWith("UPDATE cash_drawer SET status = 'open'")){Object.assign(state.drawer,{status:'open',opening_balance:args[0],opened_by:args[1]});return rows([])}
  if(s.startsWith('INSERT INTO cash_drawer_transactions')){const x={id:'cash'+(state.tx.length+1),cash_drawer_id:args[0],session_id:args[1],transaction_type:args[2],direction:args[3],amount:args[4],balance_before:args[5],balance_after:args[6],reference_type:args[7],reference_id:args[8],employee_id:args[9],notes:args[10],timestamp:'2026-10-23T08:02:00Z'};state.tx.push(x);return rows([x])}
  if(s.startsWith('UPDATE cash_drawer SET current_balance')){state.drawer.current_balance=args[0];return rows([])}
  if(s.startsWith('INSERT INTO supplier_payments')){const x={id:'pay'+(state.payments.length+1),purchase_order_id:args[0],supplier_id:args[1],amount:args[2],payment_method:args[3],bank_account_id:args[4],payment_date:args[5],employee_id:args[6],created_at:'2026-10-23T08:02:00Z'};state.payments.push(x);return rows([x])}
  if(s.startsWith('UPDATE purchase_orders SET amount_paid')){Object.assign(state.po,{amount_paid:args[0],balance_due:args[1],payment_status:args[2]});return rows([])}
  throw Error('UNMODELED '+s);
 }
 const fakePool={connect:async()=>({query,release:()=>released++}),on:()=>{}};
 class Pool{constructor(){return fakePool}}
 const db=load('server/db/postgres.js',{'pg':{Pool},'../utils/dates':{STORE_TIMEZONE:'Asia/Dubai'}});
 const cash=load('server/services/cashService.js',{'../db/postgres':db,'../../shared/errorCodes':errors,'../utils/activityLog':{logActivity:async()=>{}}});
 const journal={postSupplierPaymentEntry:async(client,p)=>{if(journalFail)throw Error('journal fail');state.journals.push(clone(p))},reverseSupplierPaymentEntries:async()=>{}};
 const bank={recordBankOut:async()=>{throw Error('bank not expected')},recordBankIn:async()=>{}};
 const pay=load('server/services/supplierPaymentService.js',{'../db/postgres':db,'../utils/dates':{storeDate:x=>new Date(x).toISOString().slice(0,10),todayStoreDate:()=> '2026-10-23'},'./journalService':journal,'../../shared/errorCodes':errors,'./cashService':cash,'./bankService':bank});
 return {state:()=>state,calls,pay,cash,released};
}
(async()=>{
 await check('C01','Cash supplier payment persists payment, PO totals, one drawer outflow and balanced journal intent',async()=>{const h=env();const r=await h.pay.addPayment({poId:'po',amount:20,method:'cash',paymentDate:'2026-10-23',employeeId:'payer'});assert.equal(h.state().payments.length,1);assert.deepEqual([h.state().po.amount_paid,h.state().po.balance_due,h.state().po.payment_status],[20,37.75,'partial']);assert.equal(h.state().drawer.current_balance,80);assert.equal(h.state().tx.length,1);assert.deepEqual([h.state().tx[0].transaction_type,h.state().tx[0].direction,h.state().tx[0].amount,h.state().tx[0].session_id,h.state().tx[0].reference_type,h.state().tx[0].reference_id,h.state().tx[0].employee_id],['supplier_payment','out',20,'session1','purchase_order','po','payer']);assert.equal(h.state().journals.length,1);assert.equal(r.treasury.balanceAfter,80);return 'Model result: paid 20, balance 37.75, drawer 100→80, one supplier_payment outflow on session1, PO reference and payer retained.'});
 await check('C02','Second cash payment settles PO and creates a second retained cash movement',async()=>{const h=env();await h.pay.addPayment({poId:'po',amount:20,method:'cash',employeeId:'payer1'});await h.pay.addPayment({poId:'po',amount:37.75,method:'cash',employeeId:'payer2'});assert.deepEqual([h.state().po.amount_paid,h.state().po.balance_due,h.state().po.payment_status],[57.75,0,'paid']);assert.equal(h.state().drawer.current_balance,42.25);assert.deepEqual(h.state().tx.map(x=>x.amount),[20,37.75]);});
 await check('C03','Closed drawer rejects supplier cash payment instead of silently creating a session',async()=>{const h=env({status:'closed',session:false});await h.pay.addPayment({poId:'po',amount:20,method:'cash',employeeId:'payer'});assert.equal(h.state().sessions.length,0,'Actual service auto-created a cash session');});
 await check('C04','Auto-opened supplier-payment session is bound to an independently selected active cashier session',async()=>{const h=env({status:'closed',session:false});await h.pay.addPayment({poId:'po',amount:20,method:'cash',employeeId:'manager'});assert.notEqual(h.state().sessions[0].opened_by,'manager','Auto-opened session is attributed to payment actor, not an independently authorized cashier/session');});
 await check('C05','Insufficient drawer cash rolls back all supplier-payment effects',async()=>{const h=env({balance:10});await assert.rejects(h.pay.addPayment({poId:'po',amount:20,method:'cash',employeeId:'payer'}),e=>e.code==='BIZ_INSUFFICIENT_CASH');assert.deepEqual([h.state().payments.length,h.state().po.amount_paid,h.state().drawer.current_balance,h.state().tx.length],[0,0,10,0]);});
 await check('C06','Journal failure rolls back payment, PO and cash movement',async()=>{const h=env({journalFail:true});await assert.rejects(h.pay.addPayment({poId:'po',amount:20,method:'cash',employeeId:'payer'}),/journal fail/);assert.deepEqual([h.state().payments.length,h.state().po.amount_paid,h.state().drawer.current_balance,h.state().tx.length],[0,0,100,0]);return 'Actual transaction wrapper issued rollback; state restoration is the fake model, not PostgreSQL proof.'});
 await check('C07','Duplicate partial request is idempotent',async()=>{const h=env();for(let i=0;i<2;i++)await h.pay.addPayment({poId:'po',amount:20,method:'cash',employeeId:'payer'});assert.deepEqual([h.state().payments.length,h.state().po.amount_paid,h.state().drawer.current_balance,h.state().tx.length],[1,20,80,1],'Same request applied twice');});
 await check('C08','Cash outflow is attached to currently open global session, regardless of payer',async()=>{const h=env();h.state().sessions[0].opened_by='cashierA';await h.pay.addPayment({poId:'po',amount:20,method:'cash',employeeId:'managerB'});assert.equal(h.state().tx[0].session_id,'session1');assert.equal(h.state().tx[0].employee_id,'managerB');return 'Session belongs to cashierA; transaction actor is managerB. The service performs no same-user/session/terminal check.'});
 console.log(JSON.stringify({runtime:process.version,isolation:'Actual postgres transaction wrapper, supplierPaymentService and cashService loaded in VM; fake pg Pool/in-memory SQL model; journal posting captured; no network, real DB, browser, timers, or file writes',results,sourceHashes:hashes},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
```

</details>

## 13. Critical Financial Integrity Risks

| Priority | Risk | Why it matters |
|---|---|---|
| 1 | F12 duplicate payment/drawer deduction | Same payable and physical cash can be settled twice through retry; reproduced in actual service logic. |
| 2 | F03/F04 wrong/global/auto-opened drawer session | Multi-terminal custody cannot identify the physical till or cashier; a closed drawer is bypassed. |
| 3 | F07 drawer-to-GL divergence | Closing discrepancy changes Treasury cash without a matching GL entry; reports can disagree. |
| 4 | F05/F10 funding/reversal integrity | Default bank is not retained, reversal can hit another bank, original payment is deleted and actor is wrong. |
| 5 | F06 cheque inconsistency | PO/supplier subledger can say paid while AP GL is still outstanding. |
| 6 | F01 source authorization | PO-pay permission can mutate cash/bank without source-specific treasury authority. |
| 7 | F13 non-durable audit | Financial action can commit without sufficient audit evidence. |
| 8 | F02 paid-draft mutability | Supplier/PO header and AP/prepayment state can drift. |

## 14. Recommended Fixes — Do Not Implement

No correction below was applied.

1. **Introduce transaction-wide idempotency first.** Use a stable operation ID and payload hash across payment, treasury, journal and response recovery. Enforce uniqueness in PostgreSQL.
2. **Define physical cash ownership.** If each terminal has a till, add drawer-terminal-cashier assignment and require an explicitly open eligible session. If one shared drawer is intentional, document custody and require physical access authorization.
3. **Remove silent auto-open from supplier payouts.** Opening must be an explicit count-and-custody event, with separate authorization.
4. **Enforce method-specific funding permissions.** PO-pay alone must not grant cash or bank withdrawal authority.
5. **Persist the actual funding allocation.** Store resolved drawer/session or bank account, treasury transaction and journal links against each immutable payment.
6. **Replace deletion with append-only reversal.** Keep original payment/evidence; use the reversing actor, exact original account, reason and linked opposite entries.
7. **Implement cheque/card lifecycle or disable them.** Model clearing/bounce/settlement accounts and source-specific authorization.
8. **Make reconciliation independently verifiable.** Recompute opening + movements, detect drift and post approved cash-over/short adjustments to both drawer and GL.
9. **Make audit persistence transactional.** Add structured immutable audit/outbox metadata inside the same transaction.
10. **Harden database invariants.** One open session, valid statuses/directions/positive amounts/arithmetic, source FKs and operation uniqueness.
11. **Define PO prepayment policy.** Use supplier advances or restrict payment states; prevent paid draft supplier/total mutations.
12. **Unify business dates.** Preserve recorded timestamp while applying an approved date consistently to payment, treasury and journal.
13. **Complete cross-terminal reconciliation.** Emit all add/reverse/open/close revisions and fetch current version on reconnect/focus.
14. **Run real isolated verification.** Execute N01–N20 against a disposable database and browser environment before any production sign-off.

## 15. Production Readiness Verdict

**NO.** The simple cash and bank paths contain the expected accounting shape, but the supplier-payment integration lacks the controls needed for reliable multi-terminal cash custody, exactly-once payouts, immutable reversal history and drawer-to-ledger reconciliation.

### Mandatory answers

| # | Direct answer | Evidence |
|---:|---|---|
| 1. Does a CASH supplier payment actually reduce the correct cash drawer balance? | **PARTIAL** | It reduces the singleton drawer; C01 showed 100→80. “Correct” physical till cannot be established because no terminal/drawer selection exists (F03). [server/services/supplierPaymentService.js:125](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:125>) |
| 2. Does the system create a cash-out movement? | **YES** | Each accepted cash payment calls recordCashOut and inserts supplier_payment/out with before/after; C01 observed one. [server/services/cashService.js:252](<D:/Projects/mahali-light/server/services/cashService.js:252>). Real DB NOT TESTED. |
| 3. Is the correct active cashier session used? | **NO** | It uses the latest global open session, regardless of payer/terminal, or auto-opens one. C03/C04/C08; [server/services/cashService.js:65](<D:/Projects/mahali-light/server/services/cashService.js:65>). |
| 4. Does BANK payment avoid affecting physical cash? | **YES** | Branch invokes bankService only; no cash call. [server/services/supplierPaymentService.js:135](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:135>). Real DB NOT TESTED. |
| 5. Does CARD payment avoid affecting physical cash? | **NOT VERIFIED** | Card is not supported by UI/backend, so no card payment lifecycle exists. [web/components/purchases/AddPaymentSlideOver.tsx:14](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:14>) |
| 6. Is the selected payment method enforced by the backend? | **YES** | Controller enum plus service allowlist enforce cash/bank_transfer/cheque and route each branch. [server/controllers/supplierPaymentsController.js:15](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:15>), [server/services/supplierPaymentService.js:45](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:45>). Source authorization by funding method is inadequate (F01). |
| 7. Are PO paid and outstanding amounts calculated correctly? | **PARTIAL** | Normal 57.75 example passed C01/C02; duplicates, paid-draft edits and cheque divergence can invalidate the aggregate. [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>) |
| 8. Are partial payments handled correctly? | **PARTIAL** | Distinct 20 + 37.75 works; identical retries are not idempotent (C07/F12). |
| 9. Can duplicate requests deduct money twice? | **YES** | C07 produced two rows, paid 40, drawer 60 and two movements from one repeated AED 20 intent. |
| 10. Can concurrent payments exceed the outstanding balance? | **NOT VERIFIED** | PO row lock should prevent two transactions whose combined amount exceeds balance, but no real concurrent PostgreSQL test ran. [server/services/supplierPaymentService.js:53](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:53>), [server/services/supplierPaymentService.js:75](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:75>) |
| 11. Are PO payment and cash movement committed atomically? | **YES** | They use the same transaction client; C05/C06 observed fake rollback. [server/services/supplierPaymentService.js:51](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:51>), [server/services/supplierPaymentService.js:126](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:126>). Actual PostgreSQL interruption durability NOT TESTED. |
| 12. Are payments reflected in Treasury? | **PARTIAL** | Cash/bank create treasury outflows and events; cheque does not. [server/services/supplierPaymentService.js:122](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:122>), [server/controllers/treasuryController.js:35](<D:/Projects/mahali-light/server/controllers/treasuryController.js:35>) |
| 13. Are supplier liabilities and financial reports updated consistently? | **PARTIAL** | Cash/bank journal DR AP and reports classify outflow correctly; cheque, paid drafts, discrepancy and date issues allow divergence. [server/services/journalService.js:625](<D:/Projects/mahali-light/server/services/journalService.js:625>) |
| 14. Are recording user, amount, method, date and time preserved? | **YES** | supplier_payments retains those fields with server created_at; movement also retains actor/time. [server/db/migrations/004_suppliers.sql:54](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:54>). Reversal attribution is wrong and UI omits time. |
| 15. Are cash drawer closing balances calculated correctly? | **PARTIAL** | Supplier payout is included, but expected trusts current_balance and discrepancy changes drawer without GL adjustment (F07). [server/services/cashService.js:446](<D:/Projects/mahali-light/server/services/cashService.js:446>) |
| 16. Can a payment be recorded without a valid funding source? | **YES** | Cheque has no funding/settlement; cash auto-opens; bank may default to an account not saved on payment. |
| 17. Does the Audit Log contain sufficient payment evidence? | **NO** | It is best-effort post-commit and lacks structured funding/session/movement/journal/before-after data (F13). |
| 18. Are financial records preserved after user soft deletion? | **YES** | Normal soft deletion retains user/business rows and joins; runtime NOT TESTED. Hard deletion/rename and reversal history remain problematic. |
| 19. Can multiple POS terminals cause inconsistent drawer balances? | **YES** | Row locking protects arithmetic, but retries can double-deduct and all terminals share one unassigned session/drawer. Correct physical-till balances cannot be represented. |
| 20. Is the supplier payment integration production-ready? | **NO** | Critical exactly-once and high-severity custody, reconciliation, funding, reversal and audit gaps remain. |

The running production database may contain no affected records; no production data was inspected. The verdict assesses the current implementation's guarantees and reproduced isolated behavior.

