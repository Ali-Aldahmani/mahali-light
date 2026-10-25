# EDARA POS — Idempotency, Duplicate Operations & Multi-Cashier Retry Safety Audit

## 1. Executive Summary

**Final verdict: CRITICAL DUPLICATION RISKS IDENTIFIED.**

Edara POS does not provide a general effectively-once business-operation layer. The audited commit, `f6bb3c0c980fbb64b2605c0d33b0cce1adbbfb5e`, has useful transactional and locking controls, but they protect only selected operations and usually only when a retry addresses the same already-created record. Most money-moving and stock-moving create commands have no stable operation identity, durable replay record, payload fingerprint, or database uniqueness constraint matching the intended business action.

The most consequential source-confirmed risks are:

- A repeated checkout can create a second draft/invoice because invoice creation has no operation key. The frontend labels a timeout as “sale was not completed” and offers retry behavior even though the commit outcome is unknown.
- Customer settlements, supplier payments, expenses, bank/cash adjustments, treasury transfers, direct stock adjustments, and partial PO receipts can be applied twice when the same intended command is submitted twice while sufficient balance/quantity remains.
- The generic Axios timeout action replays the original request configuration, while the request interceptor generates a new correlation ID. The correlation ID is not a business idempotency key.
- Invoice payment allocation is the principal explicit financial idempotency mechanism: a required key is stored with a unique `(invoice_id, idempotency_key)` index and conflicting payload reuse is rejected.
- Customer creation also has a durable request key and transaction advisory lock. This protection is operation-specific and does not extend to checkout or payments.
- Same-entity state transitions—invoice confirmation/cancellation, return approval, stock-adjustment approval, stock-count approval, and bill payment—generally use row locks and state guards. They prevent a second effect on the same record, but return a conflict instead of replaying the original result and do not stop two equivalent records from being created first.
- Return approval locks the original invoice/items and accounts for pending plus approved return quantities, which is a strong static safeguard against concurrent over-return. Runtime concurrency was not tested.
- FIFO layer creation and consumption are absent from the inspected system; therefore FIFO exactly-once behavior is **NOT IMPLEMENTED**.

This was a read-only source and schema audit. No approved isolated database was available. No API, database, concurrency, crash, restart, fault-injection, load, or browser test was executed. All T01–T22 scenarios are **NOT TESTED**. Findings marked FAIL are source-code-confirmed weaknesses, not claims that a production duplicate was observed.

Repository state at audit start included another untracked audit report. This audit preserved it and revised only this requested report. No source, schema, configuration, dependency, production record, log, container, or Git history was changed.

## 2. Architecture Discovery

The application uses Next.js/React, Express/Node.js, PostgreSQL through `pg`, Socket.IO, and Docker deployment. API routes are mounted in `server/index.js:320-371`. PostgreSQL is the authoritative store. `server/db/postgres.js:52-64` provides one transaction helper using default PostgreSQL isolation, BEGIN/COMMIT/ROLLBACK, and connection release.

The mutation flow is generally:

```text
React form/button
  → Axios API client
  → authentication + permission middleware
  → controller validation
  → service transaction
  → row locks / state check
  → business row + stock/treasury/journal rows
  → COMMIT
  → activity log / Socket.IO / notification / PDF side effects
```

The client generates `X-Request-Id` in `web/services/http.ts:37-40`. The server accepts or generates it in `server/middleware/requestId.js:10-13`, and error responses include it in `server/middleware/errors.js:50-58`. This is diagnostic correlation only: it is not stored as a unique business command, is regenerated on a retry, and does not retrieve an authoritative operation result.

Checkout is multi-request: create/update draft, add one or more payment allocations, then confirm (`web/lib/pos/checkout.ts:98-139`). These stages are not one HTTP or database transaction. Invoice confirmation atomically posts stock, customer debt, treasury, journal and invoice status in `server/services/invoiceService.js:511-723`.

There is no general queue for authoritative financial mutations. Socket.IO messages are emitted after commits and mostly refresh clients; duplicate notifications are possible but are not authoritative financial writes. Telegram reorder alerts use `reorder_alerts` as a retryable outbox (`server/services/telegramService.js:7-15`). Scheduled reports poll every minute and use `last_sent_at` as a best-effort daily guard (`server/services/scheduledReportService.js:241-318`); they are not financial mutations.

The POS store has a localStorage offline queue (`web/store/posStore.ts:161-175,494-526`) and the database has `offline_invoice_queue` (`server/db/migrations/006_invoices.sql:90-95`), but no active synchronization consumer was found. Therefore offline sale delivery/deduplication is **NOT IMPLEMENTED** in the inspected execution path.

## 3. State-Changing Endpoint Inventory

Classification: **A** naturally idempotent set-to-value operation; **B** explicit idempotency key/unique guarantee; **C** non-idempotent command protected when applied to the same persisted record; **D** duplicate business effect possible; **E** not sufficiently verified. “Transaction” describes source structure, not runtime proof.

### Financial, sales, stock and supplier endpoints

| Method and endpoint | Controller/service and principal tables | Transaction / duplicate mechanism | Class |
|---|---|---|---|
| POST `/api/invoices` | invoicesController.create; invoices/items/history | Transaction; unique generated invoice number only; no business key | D |
| PUT `/api/invoices/:id/items` | invoicesController.updateItems; invoice/items/history | Invoice row lock; replaces same draft | C |
| POST `/api/invoices/:id/payments` | invoicePaymentsController.create; invoice_payments/history | Invoice lock; required key; unique invoice/key; payload comparison and replay | B |
| POST `/api/invoices/:id/confirm` | invoiceService.confirmInvoice; invoice, stock, debt, treasury, journal | Invoice lock + draft-state guard; same ID posts once, no result replay | C |
| POST `/api/invoices/:id/cancel` | invoiceService.cancelInvoice; reversals/status/history | Invoice lock + cancelled-state guard | C |
| POST/PUT invoice edit request/approve/reject | edit request controllers/invoiceService | Request and invoice locks; pending-state transition | C |
| POST invoice PDF regeneration / print | PDF/print controllers | Repeated output generation/print is intentional; may duplicate physical receipt | E |
| POST `/api/customers` | customersController.create; customers/activity_log | Optional stable requestKey; advisory lock + unique request_key; frontend supplies stable ref key | B when key supplied, D otherwise |
| PUT/DELETE `/api/customers/:id` | customersController; customer/activity log | Locked update/deactivation and expected timestamp support | C |
| POST `/api/customers/:id/payments` | customerPaymentsController/customerService; customer_payments, debt, treasury, journal | Customer lock and balance cap; no request key | D |
| DELETE `/api/customer-payments/:id` | customerService.voidPayment; archive/debt/treasury/journal | Payment and customer locks; source ID can be voided once | C |
| POST `/api/return-requests` | returnService.createRequest; requests/items/history | Invoice/items locked and pending totals checked; no create operation key | D for duplicate request records; cumulative quantity guarded |
| PUT `/api/return-requests/:id/approve` | returnService.approveAndExecute; return order/refund/stock/treasury/journal | Request + original invoice/item locks; pending-state and cumulative caps | C |
| PUT reject/cancel return request | returnService | Request lock/state guard | C |
| POST `/api/cash-drawer/open` | cashService.openDrawer; drawer/session/transaction | Singleton drawer lock + closed/open state | C |
| POST `/api/cash-drawer/close` | cashService.closeDrawer; session/drawer | Singleton lock + open/closed state | C |
| POST `/api/cash-drawer/adjust` | cashService.recordManualAdjustment; cash transaction/balance | Atomic row lock; no source-operation uniqueness | D |
| POST `/api/cash-drawer/transfer` | cashDrawerController.transferToBank; cash, bank, transfer | One transaction; no operation key/unique business reference | D |
| POST bank deposit/withdrawal/transfer | bankAccountsController/bankService; bank/cash/transfer | Account locks and atomic transfer; no operation key | D |
| POST `/api/stock/adjustments` | stockAdjustmentsController; request/stock movement | Pending request creation has no key; direct apply is not one transaction with request insert | D |
| PUT stock-adjustment approve/reject | stockAdjustmentsController | Request lock + pending-state; stock/status same transaction for approval | C |
| POST stock count; PUT items; POST submit | stockCountsController; counts/items | Active-count application check lacks inspected unique DB constraint; transitions partly unlocked | E/C |
| PUT stock-count approve/reject | stockCountsController | Count lock + pending state; movement/status same transaction | C |
| POST `/api/purchase-orders` | purchaseOrdersController.create; PO/items | Transaction and unique PO number; no business operation key | D |
| PUT/DELETE/confirm PO | purchaseOrdersController | PO lock + draft-state guard | C |
| POST `/api/purchase-orders/:id/receive` | purchaseOrderService.receiveItems; PO items, stock, cost, journal | PO/item locks + cumulative ordered cap; no receipt identity | D for partial receipt replay |
| POST `/api/purchase-orders/:id/payments` | supplierPaymentService.addPayment; supplier payment, PO, treasury, journal | PO lock + balance cap; no request key | D |
| DELETE supplier payment | supplierPaymentService.deletePayment | Payment/PO locks and reversal | C |
| POST supplier return | supplierReturnsController.create; return/items/stock | Transaction but no operation key | D |
| PUT supplier return resolve | supplierReturnsController.resolve | Status check; read/update not shown as one locked transaction | E |
| POST `/api/expenses` | expenseService.createExpense; expense, treasury, journal, audit | One transaction; no operation key | D |
| DELETE expense | expenseService.deleteExpense | Expense lock and reversal | C |
| POST `/api/bill-payments/:id/pay` | billService.payBill; scheduled payment, treasury, journal | Bill-payment and bill locks; paid-state guard | C |
| POST bill creation / pause / resume / cancel | billService | Transactions/state operations; no create operation key | D/C |
| POST manual journal | financeController/journalService | Atomic balanced entry; no operation key | D |
| POST period close | journalService.closePeriod | Period lock + closed-state guard | C |
| POST warranty claim / resolve | warranty controllers/service | Claim/warranty locks and state guards on resolution; claim create no key | D/C |

### Administrative and secondary mutations

The following endpoints are state-changing but lower direct duplicate-loss risk: authentication login/logout/refresh; user/employee/role CRUD and permissions; product/category/attribute/variant CRUD; supplier CRUD; settings/integration updates; attendance/correction/leave/holiday commands; notification preference/read/pin/dismiss/broadcast; report schedule CRUD/run; forecast recalculate/dismiss; bug comments/status; backup run/restore/cleanup; PDF attachments/uploads; app update installation; setup completion; pricing restrictions and reorder checks. Most have no general operation ID. Set-to-state PUTs are often naturally repeatable, while create/comment/manual-run/upload commands are generally D or E. Routes are enumerated in `server/routes/*.js`; mounts are at `server/index.js:320-371`.

Backup restore, application update, setup, file upload, external Telegram calls and printing have important duplicate side effects but were not behaviorally tested. They require command-specific protections rather than the financial idempotency table alone.

## 4. Existing Idempotency Protections

1. **Invoice payment allocation — explicit and durable.** The API requires a key (`invoicePaymentsController.js:10-15,52-55`), locks the invoice, looks up existing invoice/key, compares method/amount/account/notes, and returns the prior payment on an exact replay (`:57-80`). Migration 025 creates a partial unique `(invoice_id,idempotency_key)` index. This is the strongest implemented pattern.
2. **Customer creation — explicit when the key is present.** The frontend creates one key per create-form lifecycle (`CustomerFormSlideOver.tsx:61-100,180`). The server takes a transaction advisory lock, looks up the key, and returns the prior customer (`customersController.js:452-461`). Migration 038 adds a unique request-key index.
3. **State machines with row locks.** Confirmation, cancellation, return approval, PO receiving, supplier payment balance checks, stock approval and bill payment serialize on business rows. They prevent many conflicting effects, but do not identify an intended command and usually return 409 instead of replaying success.
4. **Database-generated document numbers.** `docNumbers.js:18-37` uses atomic UPSERT sequence advancement and business-number uniqueness. This prevents duplicate numbers, not duplicate sales.
5. **Singleton and natural uniqueness.** A constant unique index protects the shared drawer; other unique constraints cover phone, PO/invoice/return numbers, active serial warranty and select notification/configuration records. They do not deduplicate equivalent payments or movements.
6. **Outbox-like reorder alerts.** Telegram sending retries unsent reorder alerts. This concerns notifications and does not provide financial command deduplication.

No general idempotency table, transaction-linked stored response, processing state, failure state, status lookup endpoint, payload hash standard, TTL policy, cleanup policy, or operation-to-audit correlation was found.

### Idempotency Key Design Assessment

| Property | Invoice allocation | Customer create | General mutations |
|---|---|---|---|
| Generator | POS payment row ID | Frontend form ref UUID/fallback | None |
| Stable across ordinary retry | Yes while payment state remains | Yes while form instance remains | No |
| Scope | Invoice + key | Global customer request key | None |
| Payload validation | Method/amount/account/notes exact comparison | No payload fingerprint; key returns prior customer regardless of changed payload | None |
| Durable | PostgreSQL | PostgreSQL | No |
| Atomic with effect | Same transaction as allocation | Same transaction as customer/audit | No |
| Concurrent same-key serialization | Invoice row lock + unique index | Advisory lock + unique index | No |
| Completed response replay | Reconstructed payment | Reconstructed customer | No |
| Processing/failure states | No | No | No |
| Restart survival | Yes | Yes | No |
| Expiry/retention | No expiry defined | No expiry defined | Not applicable |

Invoice key scope is suitable for allocation rows. It is not a checkout key: two invoices may accept the same key and each settle a sale. Customer creation lacks fingerprint validation; accidental same-key/different-payload reuse silently returns the prior customer.

## 5. Double-Submission Assessment

Critical forms usually set `saving`, `submitting`, `busy`, or `isBusy` and render disabled/loading buttons. Examples include checkout (`CashierTerminal.tsx:395-440` and `CashierPaymentDialog.tsx:94-108`), customer collection (`CollectPaymentSlideOver.tsx:46,108-114`), PO receiving (`ReceiveItemsSlideOver.tsx:57,101-104`), supplier payment (`AddPaymentSlideOver.tsx:49,113-117`), stock adjustment (`RequestAdjustmentSlideOver.tsx:48,115-122`) and return approval (`ReturnRequestCard.tsx:104-112`).

This is useful user-interface suppression but is not an authoritative guarantee. React state updates do not constitute a cross-device mutex and may not prevent two calls already dispatched before rerender. Refresh, remount, a second tab/device, API clients and the generic retry toast bypass component-local flags.

Checkout has no synchronous ref/mutex at the handler entry and no checkout operation ID. Its payment row IDs are stable while the in-memory cart survives, but payment IDs are not preserved by the session backup: `useSaleBackup.ts:6-15,67-77` omits the payment array. A refresh can therefore lose both payment intent and those idempotency keys.

## 6. Network Retry & Lost Response Analysis

The critical checkout sequence is create/update draft → add allocations → confirm. If confirm commits but the response is lost:

- the server has committed invoice, stock, treasury, debt and journal effects;
- the client catches `NETWORK_TIMEOUT` or `NETWORK_ERROR`;
- `checkoutErrorMessage` says “the sale was not completed…try again” (`web/lib/pos/checkout.ts:142-158`);
- retry first calls `saveDraft` and attempts to update the now-confirmed invoice (`:98-110,128`), which fails rather than retrieving the confirmed result;
- a user can start a new checkout, producing a second intended-equivalent invoice.

The HTTP interceptor timeout toast also offers “Retry” and calls `http.request(config)` (`web/services/http.ts:58-74`). Request interception generates a new `X-Request-Id`; the server does not use either ID to deduplicate.

No operation-status lookup distinguishes **FAILED**, **SUCCEEDED**, **PROCESSING**, and **UNKNOWN**. HTTP timeout is incorrectly presented as failed. Browser refresh restores cart/draft identity from sessionStorage if its debounced backup completed, but it does not query a checkout operation result. A tab close clears session-scoped recovery.

## 7. Sales & Invoice Duplication

Invoice creation is a D-class operation. `POST /api/invoices` generates a new invoice number and UUID in a transaction (`invoicesController.js:418-465`) with no client operation key. Two identical requests create two legitimate-looking drafts. Confirming each can deduct stock, post treasury and journal, and increase customer debt independently.

Confirming the **same invoice ID** is C-class: the invoice is locked and only draft status proceeds (`invoiceService.js:511-522`). This protects same-ID double submission, but a retry after success receives a conflict rather than the original authoritative receipt. PDF regeneration/printing does not create another sale, although repeated print commands can produce duplicate physical receipts.

Invoice payment keys protect payment allocation rows, not invoice creation or confirmation-result recovery. There is no durable checkout envelope spanning all steps.

## 8. Payment Duplication

Cash/bank/credit allocation to one draft is B-class when the supplied key is stable. Cash and bank effects are posted later during confirmation once per same invoice state transition.

Customer settlement is D-class. `customerService.collectPayment` locks the customer and caps the payment, but a duplicate smaller than the remaining debt creates a second payment, reduces debt twice, and posts treasury/journal twice (`customerService.js:52-159`).

Supplier payment is D-class. It locks the PO and caps against remaining balance (`supplierPaymentService.js:51-81`), then inserts payment and posts treasury/journal (`:83-159`). Two equal retries both succeed when their sum does not exceed the original balance.

Bill payment is C-class because the scheduled bill-payment row is locked and a paid state is rejected (`billService.js:451-500`). Manual expense creation is D-class: each retry inserts a new expense and posts treasury/journal in one internally atomic transaction (`expenseService.js:83-158`).

No external card processor integration, provider transaction ID, or webhook callback deduplication was found in the checkout path. “Bank” is recorded as a selected tender/account, not verified processor settlement.

## 9. Returns & Refunds

Creating the same return request twice can create two pending request records because there is no operation key. For invoice returns, creation locks invoice/items and includes pending plus approved quantities in committed totals (`returnService.js:54-94,585-664`); this should reject a second request that would exceed entitlement.

Approval of the same request is C-class. It locks the request and requires pending status (`returnService.js:731-743`), locks the original invoice/items, rechecks cumulative approved quantities, and writes return order, refunds, stock, debt, treasury, journal and status in one transaction. Two cashiers approving the same request should serialize; the second should receive 409. This was not runtime tested.

The design prevents over-return more strongly than it supports retry recovery: a lost approval response cannot retrieve the original result through the same command. Duplicate refund payment rows for one request are prevented indirectly by the one-time request state, not by a refund-operation key or unique return-order/tender identity.

## 10. Shared Cash Drawer

The drawer row is a database singleton and cash posting locks it. This serializes concurrent cash movements across devices and enforces nonnegative cash-out unless a path explicitly allows otherwise.

Serialization is not deduplication. Manual adjustment and cash-to-bank transfer lack operation keys. Repeating either creates a second drawer transaction. Expenses, supplier payments and customer settlements inherit their source-operation duplicate risks; each duplicate then produces another linked cash entry. The `reference_type/reference_id` pair is indexed, not unique, and some legitimate sources can have multiple movements, so deduplication needs an event identity rather than a blanket unique reference pair.

Open and close commands use drawer/session state and are C-class for the same state transition. A lost close response produces conflict on retry rather than replaying the reconciliation result.

## 11. Inventory & FIFO

Stock mutation uses a central service that locks the variant and atomically updates quantity plus inserts movement (`stockService.js:123-217`). It prevents lost updates and negative sellable stock, but accepts no idempotency key and has no unique movement-event constraint.

Sale stock deduction is once-per-same-invoice because confirmation state is locked. A second duplicate invoice deducts again. Return approval is once-per-same-request. Direct stock adjustment creation is especially risky: it calls `applyStockMovement` and then inserts the approved request using separate top-level calls (`stockAdjustmentsController.js:218-251`), creating both duplicate risk and a crash window between movement and request record.

FIFO receipt layers and FIFO consumption allocations are **NOT IMPLEMENTED**. Current cost history and variant cost snapshots cannot establish exactly-once FIFO layer creation/consumption.

## 12. Purchase Orders & Suppliers

PO create has no business key. Confirming/removing the same PO is state-guarded.

Receiving locks PO and lines, caps cumulative received quantity, and posts stock, cost history and journal atomically (`purchaseOrderService.js:102-296`). A full receipt retry is rejected because status becomes received. A partial receipt retry can succeed again while enough quantity remains: receiving 2 of 10 twice becomes 4, with two stock movements and two cost records. There is no receipt document/operation identity or unique receipt line.

Supplier payments have the analogous remaining-balance cap but no key. Supplier return creation can repeat stock-out and return records. Supplier-return resolve uses a status check, but the inspected read/update path is not protected by a row lock in one transaction and remains E-class pending concurrency testing.

## 13. Database Constraints

PostgreSQL transactions and row locks provide strong atomicity inside individual services. The default READ COMMITTED isolation is used; no serialization/deadlock retry framework exists. Locking protects stock rows, invoices, POs, customers, returns, claims, drawer and accounts.

The uniqueness scope often represents record identity rather than business-operation identity:

- UUID primary keys permit two equivalent rows.
- Unique invoice/PO/return numbers ensure distinct numbers for duplicates rather than preventing duplicates.
- Treasury and stock tables index `reference_type,reference_id` but do not make that pair unique (`003_stock.sql:96-100`, `010_treasury.sql:114-124`).
- Supplier payments, customer payments, refund payments, expenses, PO receipt cost histories and cash/bank transactions have no request-key uniqueness.
- Journal entries index reference type/ID but do not enforce one entry per event type/reference (`013_finance.sql:39-65`).

Application checks followed by inserts are race-prone unless protected by a lock covering the correct business identity or a unique constraint. The invoice allocation and customer create paths have both. Most create paths do not.

## 14. Multi-Cashier Concurrency

Static reasoning is independent of whether 2, 5, 10 or 20 clients participate:

- Same persisted invoice/return/approval ID: row locks serialize and state guards usually permit one effect.
- Same invoice allocation key: invoice lock plus unique index provides one row.
- Different keys representing one real payment: treated as legitimate separate operations.
- Two separate checkout requests for one real sale: both can create and confirm.
- Same customer settlement submitted twice: serialized but both can post if balance permits.
- Same partial PO receipt submitted twice: serialized but both can post if ordered remainder permits.
- Same manual adjustment/transfer/expense submitted twice: both can post.
- Two genuinely independent sales of the same product: correctly remain independent; stock row locking controls availability rather than deduplicating them.

Concurrency capacity and deadlock behavior at 2/5/10/20 cashiers are **NOT TESTED**. No throughput or benchmark claim is made.

## 15. Crash & Restart Recovery

| Crash window | Code-supported outcome |
|---|---|
| Before transaction | No effect; retry starts new operation |
| During PostgreSQL transaction | PostgreSQL rollback is intended; runtime crash recovery NOT TESTED |
| After commit, before HTTP response | Effect exists; most commands have unknown outcome and unsafe new replay |
| After business commit, before generic activity/socket/PDF | Business effect remains; secondary evidence/delivery may be absent |
| After invoice allocation, before confirmation | Durable draft allocation exists; retry with same key is safe, but full checkout remains incomplete |
| Direct stock movement before adjustment-request insert | Separate top-level operations create a source-record crash window |
| External Telegram send before sent flag update | Notification may be delivered twice |
| Server restart | PostgreSQL keys/state survive; in-memory submission flags and timers do not |

No crash or restart was performed.

## 16. Frontend Retry Behavior

The cashier sale backup stores cart/customer/discount/notes/draft identity in sessionStorage, debounced by 300 ms (`useSaleBackup.ts:37-100`). It omits payments and any checkout operation ID. Refresh can therefore restore an incomplete ambiguous sale. If confirmation committed before refresh, the restored draft ID points at a confirmed invoice, but there is no automatic status recovery.

The local offline queue uses randomly generated local IDs and removes entries after reported success. No server sync implementation or durable uniqueness linkage was found. It should not be considered operational duplicate protection.

Axios does not automatically retry all requests, but the timeout toast exposes a generic manual replay. The application must not attach that action to unsafe POST/DELETE/financial PUT commands unless they carry a stable operation key.

## 17. Background Jobs & Events

Socket events are emitted after many commits. Reconnection or duplicate delivery may refresh the UI twice, but no inspected socket listener executes authoritative sale/payment mutations.

Telegram stock alerts are retryable outbox-like notifications. The sender can still face the classic external “sent but acknowledgement lost” ambiguity because Telegram message delivery is not keyed by an application operation ID; this affects notification duplication, not inventory.

Scheduled reports use an in-memory interval and `last_sent_at`. Two server processes could select the same due schedule before either updates it because no claim/lock/unique run row was found. Duplicate generated reports/notifications are possible. Financial authoritative rows are not created by these jobs.

## 18. Error Handling & Audit Logging

Implemented invoice allocation responses distinguish new (201), exact replay (200), conflicting key payload (409), and locked invoice (409). They do not expose PROCESSING because the invoice row lock blocks concurrent duplicate requests until one completes.

General commands do not distinguish new/replay/processing/unknown because no idempotency record exists. Unique violations are not standardized into authoritative replay responses. Timeout UI says failure despite unknown outcome. State-transition retries generally return invalid-state conflict without the original result reference.

Recommended semantics:

- `201/200`: first completion / exact replay with the same authoritative resource and result.
- `202`: operation still processing, with status URL.
- `409 IDEMPOTENCY_KEY_REUSED`: same key, different canonical payload.
- Explicit safe failure: transaction rolled back and retry with same key is allowed.
- Explicit unknown: client must poll status and must not create a new operation.

### Duplicate-Attempt Traceability

Request IDs correlate errors and server logs but are not included in the persisted error-log insert call at `server/middleware/errors.js:32-44`; only the response and console include `req.id`. Activity log schema/calls do not consistently record operation key, request ID, device, first/retry timestamps, replayed result or duplicate decision.

Invoice allocation exact replay returns before generic activity logging (`invoicePaymentsController.js:145-153`), which avoids a misleading second financial activity entry. Customer creation similarly suppresses duplicate create broadcast. These are good local patterns.

For unprotected operations, two attempts look like two legitimate transactions. There is no reliable audit query that distinguishes duplicate intent from legitimate repeated business.

## 19. Safe Test Results

No approved isolated environment was identified. All requested behavioral tests are **NOT TESTED**. The procedures below are recommendations for a disposable PostgreSQL database with synthetic products/customers/accounts, separate API process, and transaction-table snapshots before/after.

| Test | Exact request sequence | Expected invariants | Result |
|---|---|---|---|
| T01 double-click checkout | Dispatch identical UI intent twice before first response | 1 invoice/payment set/stock sale/drawer posting | NOT TESTED |
| T02 concurrent identical checkout | Two POST-create/payment/confirm flows | One operation result if same key; otherwise two legitimate IDs demonstrate gap | NOT TESTED |
| T03 retry after commit | Repeat same checkout operation ID | Original invoice returned; counts remain 1 | NOT TESTED |
| T04 lost response | Proxy drops confirm response, then client polls/retries same key | Original sale recovered; no second invoice | NOT TESTED |
| T05 same key/different payload | Concurrent and sequential allocation requests | 409 mismatch; one row | NOT TESTED |
| T06 duplicate cash allocation | Same invoice/key twice | One allocation and later one cash posting | NOT TESTED |
| T07 duplicate split allocation | Replay every tender key | One row per intended tender | NOT TESTED |
| T08 duplicate customer settlement | Same intended collection twice | One payment/debt decrement/treasury/journal | NOT TESTED |
| T09 duplicate refund approval | Approve same request twice | One order/refund/stock restoration | NOT TESTED |
| T10 two-cashier refund | Two connections approve same request | One succeeds; second returns authoritative result or conflict | NOT TESTED |
| T11 duplicate drawer withdrawal | Same adjustment/transfer key twice | One drawer entry and one balance delta | NOT TESTED |
| T12 duplicate supplier payment | Same intended PO payment twice | One payment/treasury/journal | NOT TESTED |
| T13 duplicate PO receipt | Replay partial receipt of 2/10 | One receipt identity, quantity_received=2 | NOT TESTED |
| T14 duplicate stock adjustment | Repeat direct and approval paths | One movement and one request | NOT TESTED |
| T15 duplicate FIFO movement | Replay layer creation/consumption | One allocation; layer conservation | NOT TESTED; FIFO absent |
| T16 refresh pending checkout | Refresh at create/allocation/confirm phases | Stable operation lookup and safe resume | NOT TESTED |
| T17 network interruption payment | Drop responses at allocation/settlement commit | Poll/replay without duplicate | NOT TESTED |
| T18 crash after commit | Kill isolated API after COMMIT before response | Restart exposes same authoritative result | NOT TESTED |
| T19 multiple devices | 2/5/10/20 clients submit same and distinct keys | Same key one effect; distinct real sales all accepted | NOT TESTED |
| T20 independent same-product sales | Different operation IDs, sufficient stock | Both succeed; no false deduplication | NOT TESTED |
| T21 expired key | Retry after operation-specific retention | Historical completed operation remains protected | NOT TESTED; no TTL |
| T22 duplicate event | Redeliver outbox/schedule event | At most one authoritative effect; notification policy explicit | NOT TESTED |

Each future run must record table counts and sums for invoices, invoice/customer/supplier/refund payments, stock movements, PO received quantities, drawer/bank transactions, journal entries/lines, debt and operation records. A PASS requires database invariants, not only HTTP status.

## 20. Business Invariant Matrix

| Invariant | Existing protection | Assessment |
|---|---|---|
| One checkout → at most one invoice | None spanning checkout | FAIL |
| One payment event posts once | Invoice allocation key only | PARTIAL |
| One refund authorization pays once | Request lock/state | PARTIAL |
| One stock event applies once | Source state guards on selected paths; no event key | PARTIAL |
| One PO receipt increases stock once | Cumulative cap, no receipt identity | FAIL for partial retry design |
| One drawer movement posts once | Serialized balance, no command key | FAIL |
| FIFO consumption follows stock | FIFO layers absent | NOT IMPLEMENTED |
| Customer balance counts payment once | Lock/cap, no collection key | FAIL |
| Retry cannot bypass permissions | Authentication/permission middleware runs on every request | PASS by source design only; runtime NOT TESTED |
| Unknown response does not falsely confirm new transaction | UI states sale was not completed | FAIL |
| Independent operations remain accepted | Random/new IDs normally create distinct records | PARTIAL; future key scoping must preserve this |
| Transaction retries preserve integrity | Atomic internals, incomplete operation dedup/recovery | PARTIAL |

## 21. Critical Findings

### ID-01 — Checkout has no durable business-operation identity

- **Severity:** CRITICAL
- **Affected module / endpoint:** Checkout; `POST /api/invoices`, `POST /api/invoices/:id/confirm`
- **Location:** `web/lib/pos/checkout.ts:98-139`; `server/controllers/invoicesController.js:418-465`; `server/services/invoiceService.js:511-723`
- **Actual evidence:** New draft creation always generates a new invoice; only same invoice ID confirmation is state-guarded.
- **Reproduction scenario:** Dispatch or manually repeat the complete checkout as two new create flows.
- **Expected:** One stable operation returns one authoritative invoice.
- **Actual/code-supported:** Two invoice IDs can be created and independently confirmed.
- **Impact:** Duplicate sale, stock deduction, tender posting, customer debt, tax and journal.
- **Recommended fix:** Client-generated checkout operation UUID, canonical payload hash, durable operation row and unique store/operation constraint committed with invoice creation; status endpoint and result replay.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; runtime NOT TESTED

### ID-02 — Lost successful checkout response is treated as failure

- **Severity:** CRITICAL
- **Affected module / endpoint:** Frontend checkout and all unsafe generic retries
- **Location:** `web/lib/pos/checkout.ts:142-158`; `web/services/http.ts:58-74`; `web/components/cashier/CashierTerminal.tsx:395-440`
- **Actual evidence:** Timeout message says sale not completed; generic Retry reissues config; no operation-status lookup exists.
- **Reproduction scenario:** Commit confirmation, drop HTTP response, press retry or start new sale.
- **Expected:** UNKNOWN → poll operation → expose original receipt.
- **Actual/code-supported:** Same confirmed draft update fails; user is encouraged to retry without authoritative resolution.
- **Impact:** Duplicate sale or unresolved already-completed payment.
- **Recommended fix:** Outcome state machine and operation lookup; remove generic retry for unsafe methods unless a stable key is present.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; fault injection NOT TESTED

### ID-03 — Customer settlement has no idempotency key

- **Severity:** CRITICAL
- **Affected module / endpoint:** Customer payment; `POST /api/customers/:id/payments`
- **Location:** `server/services/customerService.js:52-159`; `server/routes/customers.js:34-38`
- **Actual evidence:** Customer lock/cap followed by unconditional payment/debt/treasury/journal posting; no request key.
- **Reproduction scenario:** Repeat 50 settlement against debt 200.
- **Expected:** One 50 effect.
- **Actual/code-supported:** Both serialized requests can succeed; debt decreases 100.
- **Impact:** False receivable reduction and duplicate cash/bank/journal.
- **Recommended fix:** Durable customer-scoped settlement operation key and fingerprint, unique constraint, atomic replay result.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; runtime NOT TESTED

### ID-04 — Partial PO receipt replay increases inventory again

- **Severity:** CRITICAL
- **Affected module / endpoint:** Purchasing; `POST /api/purchase-orders/:id/receive`
- **Location:** `server/services/purchaseOrderService.js:93-203,248-296`
- **Actual evidence:** PO/line locks and cumulative cap, but no receipt identity. Each accepted call posts stock/cost/journal.
- **Reproduction scenario:** Receive 2 of ordered 10, lose response, repeat 2.
- **Expected:** quantity_received=2 and one movement.
- **Actual/code-supported:** quantity_received=4 while remainder permits.
- **Impact:** Overstated stock, inventory asset/payable and cost history.
- **Recommended fix:** Receipt command/header ID, unique PO/receipt identity, receipt lines, payload fingerprint and result replay.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; runtime NOT TESTED

### ID-05 — Supplier payment can post twice

- **Severity:** CRITICAL
- **Affected module / endpoint:** `POST /api/purchase-orders/:id/payments`
- **Location:** `server/services/supplierPaymentService.js:29-159`
- **Actual evidence:** PO lock and balance cap but no payment event ID.
- **Reproduction scenario:** Repeat 100 payment while PO balance is at least 200.
- **Expected:** One supplier payment.
- **Actual/code-supported:** Two payments, two treasury debits and two journal entries.
- **Impact:** Duplicate cash outflow and understated payable.
- **Recommended fix:** Supplier-payment request key/provider reference uniqueness and atomic replay.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; runtime NOT TESTED

### ID-06 — Shared drawer and treasury commands are serialized but not deduplicated

- **Severity:** CRITICAL
- **Affected module / endpoint:** `POST /api/cash-drawer/adjust`, `/transfer`; bank deposit/withdrawal/transfer
- **Location:** `server/controllers/cashDrawerController.js:97-109,222-266`; `server/controllers/bankAccountsController.js:109-186,201-230`; `server/services/cashService.js:169-275`
- **Actual evidence:** Account/drawer rows lock, but each request inserts a new transaction; reference indexes are nonunique.
- **Reproduction scenario:** Double-submit a 100 withdrawal or transfer.
- **Expected:** One movement.
- **Actual/code-supported:** Two movements if funds allow.
- **Impact:** Physical/book cash and bank balances moved twice.
- **Recommended fix:** Required operation ID for every manual treasury command and transfer; unique event row and replay response.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; runtime NOT TESTED

### ID-07 — Direct stock adjustment has duplicate and crash-window risk

- **Severity:** HIGH
- **Affected module / endpoint:** `POST /api/stock/adjustments` with direct apply
- **Location:** `server/controllers/stockAdjustmentsController.js:171-285`
- **Actual evidence:** Movement is applied through its own transaction, then request row is inserted separately; no key.
- **Reproduction scenario:** Duplicate submission or crash after movement before request insert.
- **Expected:** One request and one atomically linked movement.
- **Actual/code-supported:** Duplicate moves; or movement without adjustment request.
- **Impact:** Inventory quantity/audit drift.
- **Recommended fix:** One transaction client for movement and request plus stable adjustment operation ID and unique constraint.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; crash NOT TESTED

### ID-08 — One-time expense creation is repeatable

- **Severity:** HIGH
- **Affected module / endpoint:** `POST /api/expenses`
- **Location:** `server/services/expenseService.js:57-159`
- **Actual evidence:** Atomic insert/treasury/journal/audit but no operation key or semantic uniqueness.
- **Reproduction scenario:** Timeout after commit, replay same expense form.
- **Expected:** Original expense result.
- **Actual/code-supported:** Second expense and treasury/journal debit.
- **Impact:** Duplicate expense and cash/bank reduction.
- **Recommended fix:** Expense operation key and payload fingerprint; store/replay result in same transaction.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness; runtime NOT TESTED

### ID-09 — Invoice allocation protection is narrow but correctly structured

- **Severity:** MEDIUM
- **Affected module / endpoint:** `POST /api/invoices/:id/payments`
- **Location:** `server/controllers/invoicePaymentsController.js:10-15,52-80,106-145`; `server/db/migrations/025_invoice_payment_idempotency.sql:1-5`
- **Actual evidence:** Required key, invoice lock, payload validation, unique index and prior-result replay.
- **Reproduction scenario:** Same key/same payload, then same key/different payload.
- **Expected:** Exact replay / 409 mismatch.
- **Actual/code-supported:** Matches expected statically.
- **Impact:** Protects allocation rows; does not protect checkout identity.
- **Recommended fix:** Preserve mechanism, canonicalize payload comparison, expose replay metadata, integrate under checkout operation.
- **Confidence:** High
- **Verification:** PARTIAL — source design strong; runtime/concurrency NOT TESTED

### ID-10 — Return approval is at-most-once per request but not retry-recoverable

- **Severity:** MEDIUM
- **Affected module / endpoint:** `PUT /api/return-requests/:id/approve`
- **Location:** `server/services/returnService.js:54-94,731-835,1034-1194`
- **Actual evidence:** Request/invoice/item locks, pending-state guard and cumulative approved recheck.
- **Reproduction scenario:** Two managers approve same request; or response lost after commit.
- **Expected:** One effect and original result replay.
- **Actual/code-supported:** One effect intended; second receives invalid-state conflict, not original result.
- **Impact:** Duplicate payout/restock appears prevented for same request; recovery/UX remains ambiguous.
- **Recommended fix:** Add approval command identity/result lookup or make status GET return complete authoritative execution result after conflict.
- **Confidence:** Medium-high
- **Verification:** PARTIAL — source-supported; runtime concurrency NOT TESTED

### ID-11 — Correlation IDs and audit logs do not expose duplicate attempts

- **Severity:** HIGH
- **Affected module / endpoint:** All mutations
- **Location:** `web/services/http.ts:37-40`; `server/middleware/requestId.js:10-13`; `server/middleware/errors.js:32-58`; `server/utils/activityLog.js:3-37`
- **Actual evidence:** New request ID per retry; error persistence omits request ID; activity schema lacks operation/replay fields.
- **Reproduction scenario:** Send two equivalent payment commands.
- **Expected:** One operation with attempt history and final resource.
- **Actual/code-supported:** Two unrelated request traces and, on vulnerable paths, two business records.
- **Impact:** Duplicate investigation and reconciliation are unreliable.
- **Recommended fix:** Persist operation ID plus per-attempt request/device/user metadata without sensitive payloads.
- **Confidence:** High
- **Verification:** FAIL — source-code-confirmed weakness

### ID-12 — FIFO exactly-once guarantees cannot exist without FIFO layers

- **Severity:** HIGH
- **Affected module / endpoint:** Sale confirmation, PO receive, return
- **Location:** `server/services/purchaseOrderService.js:188-218`; `server/services/invoiceService.js:652-666`; baseline migrations 002–038
- **Actual evidence:** Cost history/current cost snapshots exist; no remaining receipt layers or consumption allocation table.
- **Reproduction scenario:** Two cost layers, sale spanning layers, retry sale/return.
- **Expected:** One immutable layer allocation per authoritative stock movement.
- **Actual/code-supported:** Layer identity/consumption absent.
- **Impact:** Cannot reconcile costing effects or deduplicate FIFO consumption.
- **Recommended fix:** Implement receipt layers and unique movement-to-consumption allocations after business-event idempotency.
- **Confidence:** High
- **Verification:** NOT IMPLEMENTED

## 22. Prioritized Remediation Roadmap

1. **P0 — Checkout operation envelope.** Add client-generated `checkoutOperationId`, durable operation table with store/user/device scope, canonical payload hash, states PROCESSING/SUCCEEDED/FAILED_SAFE, invoice ID/result JSON, and unique scope. Create invoice and claim operation atomically. Add `GET /api/operations/:id`. Confirmation retry must return the confirmed invoice.
2. **P0 — Money-moving command keys.** Require stable operation IDs for customer settlement, supplier payment, expense, manual cash/bank movements and transfers. Commit key/result with business/treasury/journal effects. Reject key payload mismatch.
3. **P0 — PO receipt identity.** Add receipt header/line records and unique PO/receipt operation key. Link stock movements, cost history and journal to receipt ID.
4. **P0 — Unknown-outcome UI.** Replace “not completed” on timeout with “outcome unknown—checking.” Poll operation status. Remove generic unsafe POST retry action when no idempotency key exists.
5. **P1 — Inventory event identity.** Make every stock movement reference a unique authoritative event/line. Move direct adjustment request and movement into one transaction.
6. **P1 — Result replay for state transitions.** Same confirmed/cancelled/approved request should expose existing result when command identity/payload matches, while still rejecting a genuinely conflicting action.
7. **P1 — Traceability.** Persist operation ID, request attempt ID, user/device, endpoint, timestamps, replay/mismatch decision and final resource. Avoid sensitive payload logging.
8. **P1 — Transactional outbox.** Use for required postcommit financial notifications/doc generation only where durable delivery matters. Consumers deduplicate by event ID.
9. **P1 — FIFO subsystem.** Receipt layers and movement-linked consumption allocations with deterministic locking, reversals and uniqueness.
10. **P2 — Retention.** Financial/payment/checkout/receipt operation identities should be retained at least as long as the underlying records and legal/audit recovery horizon. Short TTLs are unsafe. Nonfinancial UI commands may use shorter documented retention.

Compatibility risks include old clients without keys, existing duplicate data, legitimate multiple payments/receipts that need distinct IDs, large stored response payloads, and deadlocks from inconsistent lock order. Roll out in observe/optional mode only for low-risk paths; do not allow missing keys on critical new commands after client migration. Backfill cannot infer historical intended-operation identity.

## 23. Required Regression Tests

Before production certification, automate T01–T22 against a disposable PostgreSQL database and real HTTP server. Add:

- same-key concurrency barriers with 2, 5, 10 and 20 independent connections;
- same-key/different-payload canonicalization tests;
- distinct-key identical-payload tests proving legitimate independent operations are accepted;
- commit-response-loss proxy tests and server restart between commit and reply;
- migration uniqueness tests and safe conflict mapping;
- balance/count assertions across business, treasury, stock and journal tables;
- permission revalidation on every replay/status lookup;
- operation retention and archived-result retrieval;
- deadlock/serialization error handling with bounded safe retry;
- outbox consumer redelivery;
- UI refresh/remount tests retaining operation identity;
- direct API tests independent of disabled buttons.

A regression PASS requires exactly one authoritative resource/effect and the original result on retry. A 409 alone is not a complete retry-safety PASS if the caller cannot determine whether money or stock moved.

## 24. Production Readiness Verdict

**Final verdict: CRITICAL DUPLICATION RISKS IDENTIFIED.**

The pinned commit is not safe against duplicate authoritative effects under retries and multi-cashier concurrency. It has strong local controls for invoice allocation keys and same-record state transitions, but checkout creation, customer settlement, supplier payment, partial PO receipt, treasury movements, expenses, and direct stock adjustments lack durable intended-operation identity. Runtime concurrency and crash recovery remain NOT TESTED because no approved isolated environment was available.

### Required summary matrix

| Operation | Frontend Protection | Backend Idempotency | Database Guarantee | Retry Safety | Verdict |
|---|---|---|---|---|---|
| Checkout | Submitting/loading flag | No checkout operation key | No checkout-operation uniqueness | Unknown result cannot be recovered | FAIL |
| Invoice creation | Submit UI state only | None | Unique number/UUID, not business intent | Retry creates another invoice | FAIL |
| Cash payment | Busy state; tender row ID | Invoice allocation key only | Unique invoice/key | Safe only for same retained allocation key | PARTIAL |
| Split payment | Busy state; one ID per row | One key per allocation | Unique invoice/key per tender | Safe while every original key survives | PARTIAL |
| Customer settlement | Saving button | Customer lock, no idempotency | No operation uniqueness | Duplicate can post | FAIL |
| Refund | Busy approval UI | Request state and cumulative caps | Same request row serialized | Conflict after success; no result replay | PARTIAL |
| Shared cash drawer debit | Loading/disabled controls vary | Drawer lock, no command key | No unique source operation | Duplicate can debit | FAIL |
| Inventory deduction | Checkout/approval busy state | Same invoice/request state guards | Variant locks; no universal event uniqueness | Duplicate source entity repeats movement | PARTIAL |
| FIFO consumption | None | None | No FIFO layer/allocation schema | Impossible to recover/deduplicate | NOT IMPLEMENTED |
| PO receiving | Saving button | PO/item locks, no receipt key | Cumulative cap only | Partial retry repeats receipt | FAIL |
| Supplier payment | Saving button | PO lock/balance cap, no key | No payment-operation uniqueness | Duplicate can post | FAIL |

### Final questions

1. **Can double-clicking Pay create duplicate sales?** Yes. UI disabling reduces likelihood, but no backend checkout-operation identity prevents two create flows.
2. **Can retrying after a lost response create a second invoice?** Yes. The original confirmed result cannot be looked up by operation identity, and a new checkout can create another invoice.
3. **Can the same payment be recorded twice?** Invoice allocation is protected for the same stable key. Customer settlements, supplier payments and other money commands can be recorded twice.
4. **Can two cashiers refund the same invoice simultaneously?** Competing requests can be created, but invoice/item locks and cumulative pending/approved caps are designed to stop over-entitlement. Same-request approval is state-guarded; runtime proof is absent.
5. **Can duplicate requests debit the shared cash drawer twice?** Yes for unkeyed customer/supplier payments, expenses, adjustments and transfers when funds permit.
6. **Can stock be deducted twice for one intended sale?** Same invoice confirmation is guarded. Two invoices created for one intended checkout can each deduct stock.
7. **Can supplier receiving increase inventory twice?** Yes. A repeated partial receipt can be accepted while ordered quantity remains.
8. **Are idempotency keys implemented and durable?** Yes, narrowly for invoice payment allocations and optional customer creation; both persist in PostgreSQL.
9. **Are keys correctly scoped and validated?** Invoice allocation scope and payload checks are strong. Customer creation lacks payload fingerprint validation. Critical operations have no keys.
10. **Are database constraints sufficient?** No. Most constraints identify rows or document numbers rather than intended business operations.
11. **Can a server crash create retry-related duplication?** Yes for commands without durable operation records, especially after commit before response. Direct stock adjustment also has a source-record crash window.
12. **Can the frontend recover unknown transaction outcomes?** No. It treats timeout as noncompletion and has no operation-status lookup.
13. **Can legitimate independent operations be incorrectly rejected?** Current code generally accepts them. A future design must scope keys to client-declared intent and never deduplicate by payload alone.
14. **Are duplicate attempts traceable in logs?** Not systematically. Request IDs are correlation IDs, are regenerated on retry, and are not an operation-attempt ledger.
15. **Which operations have confirmed duplicate risks?** Checkout/invoice create, customer settlement, supplier payment, partial PO receive, expense creation, manual cash/bank operations, transfers and direct stock adjustment are source-code-confirmed weaknesses.
16. **Which operations are protected only by frontend checks?** The listed vulnerable create/payment/treasury commands commonly have saving/loading flags but lack matching durable backend idempotency.
17. **Which operations require database-level safeguards?** Checkout, customer settlement, supplier payment, PO receipt, expense, treasury movement, direct stock adjustment and authoritative background event processing.
18. **What must be fixed before production use?** Implement P0 stable operation IDs, payload fingerprints, atomic result records, uniqueness constraints, status lookup, unknown-outcome UI, and isolated concurrency/crash tests.
19. **Is Edara POS safe against duplicate business effects under multi-cashier concurrency?** No. It is only partially protected for selected same-record transitions and invoice allocation keys.

**Verdict: CRITICAL DUPLICATION RISKS IDENTIFIED.** The conclusion is supported by direct source evidence of missing business-operation identities on commands that create financial, treasury and inventory effects. No production duplicate is alleged, and no runtime test result is fabricated.

---

Audit safety record: source and schema inspection only; no behavioral tests, database access, financial operations, production requests, fault injection, load tests, container restarts, dependency changes, source edits, migrations or commits. Only this report was revised by this audit.

