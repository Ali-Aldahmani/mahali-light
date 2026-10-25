# EDARA POS — Transaction Atomicity, Rollback Integrity & Partial Failure Audit

**Audit date:** 2026-10-24  
**Baseline:** `b14d912431b92cfefa5e9e928bda5c5459ff0947`  
**Method:** read-only static analysis  
**Runtime:** **NOT TESTED**. No approved isolated PostgreSQL environment was supplied, so no tests, database commands, containers, production operations, or fault injection were run.

## 1. Executive Summary

Edara POS uses PostgreSQL 16 through Node's `pg` pool. Its main financial writers usually pass one checked-out client through dependent SQL and lock the principal invoice, stock, customer, PO, return, drawer, or bank row. Sale confirmation, cancellation, return execution, PO receipt, customer/supplier payment, expense posting, stock-count approval, warranty replacement, and treasury transfer therefore have credible rollback behavior for ordinary SQL failures.

The complete system is **not transactionally safe across the stated requirements**. Direct manager stock adjustment commits stock/movement/journal before inserting its approval record. FIFO and inventory transfers are absent. Only draft invoice-payment allocation has durable request idempotency, so response-loss retries can duplicate most other money/stock commands. Warranty replacement consumes stock without inventory-value accounting. Sale warranties, audit rows, some events/notifications, and files cross unsafe commit boundaries. Database constraints do not independently enforce many critical invariants.

**Production verdict: FAIL / NOT TESTED.** Core sale, return, receiving, and shared-drawer paths are promising, but the confirmed split commit, missing FIFO, retry exposure, and incomplete audit/external recovery prevent a production-safe multi-cashier claim.

## 2. Database Transaction Architecture

| Topic | Evidence | Status | Assessment |
|---|---|---|---|
| Engine | `docker-compose.yml:8-30` | **PASS** | PostgreSQL 16, persistent Docker volume, DB port not published to LAN. |
| Driver/pool | `server/db/postgres.js:1-31` | **PASS** | `pg.Pool`; no ORM/repository layer. |
| Wrapper | `server/db/postgres.js:52-65` | **PASS** | Same client runs `BEGIN`, awaited callback, `COMMIT`, or `ROLLBACK`, then releases. |
| Isolation | No `SET TRANSACTION` | **PARTIAL** | PostgreSQL `READ COMMITTED`; safety relies on locks/constraints. |
| Autocommit | `postgres.js:48-50` | **PARTIAL** | Global `query()` inside a transaction callback escapes the parent transaction. |
| Savepoints/nesting | None | **NOT IMPLEMENTED** | Services join outer work only by accepting `client`. |
| Retry/deadlock | None | **NOT IMPLEMENTED** | SQLSTATE deadlock/serialization failures reach caller. |
| Timeouts | No per-transaction statement/lock/idle timeout | **NOT IMPLEMENTED** | PostgreSQL/server defaults apply. |
| Unknown commit | No command-status record | **FAIL** | Lost HTTP acknowledgement cannot establish commit versus rollback. |

Async callback exceptions are rolled back. If `ROLLBACK` itself fails, it can mask the initiating error; the helper does not explicitly destroy that client.

## 3. Critical Operation Inventory

| # | Operation; endpoint/controller/service | Main tables | Status |
|---:|---|---|---|
| 1 | Checkout; `POST /invoices`, `/:id/payments`, `/:id/confirm`; invoice controllers/service | Invoice, stock, customer, treasury, journals | **PARTIAL** |
| 2 | Invoice creation; `invoicesController.create` | `invoices`, items, history | **PASS** core |
| 3 | Cash payment; draft allocation + confirm | Payments, drawer, journals | **PASS** core |
| 4 | Card recording; internal method `bank`, no gateway | Payments, bank, journals | **PARTIAL** |
| 5 | Split payment; multiple allocations, one confirm | Invoice/customer/treasury/journal | **PASS** core |
| 6 | Partial payment; draft only unless remainder is credit | Invoice/payment | **PARTIAL** |
| 7 | Credit sale; `confirmInvoice` | Customer/invoice/stock/journal | **PASS** core |
| 8 | Debt settlement; `POST /customers/:id/payments`; `customerService` | Customer payment/debt/treasury/journal | **PARTIAL** |
| 9 | Cash refund; return approval | Return/stock/cash/journal | **PASS** core |
| 10 | Non-cash refund; return approval | Return/bank or customer/journal | **PASS** internal |
| 11 | Return/replacement; `returnService.approveAndExecute` | Return/invoice/stock/treasury/journal | **PASS** core |
| 12 | Inventory adjustment; stock adjustment controller | Request/variant/movement/journal | **FAIL** direct path |
| 13 | Inventory transfer | No location model/route/service/table | **NOT IMPLEMENTED** |
| 14 | FIFO consumption | No layers/allocations | **NOT IMPLEMENTED** |
| 15 | PO receiving; `purchaseOrderService.receiveItems` | PO/stock/cost/journal | **PASS** core |
| 16 | Supplier payment; `supplierPaymentService` | Payment/PO/treasury/journal | **PARTIAL** |
| 17 | Expense; `expenseService` | Expense/treasury/journal/file | **PARTIAL** |
| 18 | Drawer movement; `cashService` | Drawer/session/transactions/transfers | **PASS** subledger; **PARTIAL** GL |
| 19 | Invoice cancellation; `invoiceService.cancelInvoice` | Invoice/stock/customer/treasury/journal/warranty | **PARTIAL** |
| 20 | PO cancellation | Draft delete only | **NOT IMPLEMENTED** for committed POs |
| 21 | Warranty replacement; `warrantyService.resolveWarrantyClaim` | Claim/warranty/invoice/stock | **PARTIAL** |
| 22 | Corrections/reversals | Source-specific void/delete/cancel and manual journal | **PARTIAL** |

## 4. Transaction Boundary Map

| Workflow | Start and required writes | Commit/rollback | Outside boundary |
|---|---|---|---|
| Draft invoice | Controller `withTransaction`: header, items, totals, history | Callback resolve / thrown error | Activity and response read |
| Allocation | `invoicePaymentsController.js:57`: invoice lock, replay check, payment, totals, history | Same | Activity |
| Confirm | `invoiceService.js:511`: locks; stock, debt, treasury, journals, status/history | Same; any required error aborts | Activity, sockets, warranties, PDF/print |
| Cancel | `invoiceService.js:867`: stock/debt/treasury/journal reversals, status/history | Same | Activity, event, warranty void, PDF |
| Return | `returnService.js:731`: request/order/items, disposition, refund, replacement, journals/history | Same | Events after commit; activity leaks |
| Customer collection | `customerService.js:52`: payment, debt, treasury, journal, activity | Same | Events/readback |
| PO receipt | `purchaseOrderService.js:102`: locks, stock, receipt qty, costs, VAT, status, journal | Same | Activity/events/reorder |
| Supplier payment | `supplierPaymentService.js:51`: payment, PO balance, treasury, journal | Same | Activity/event/file |
| Expense | `expenseService.js:83`: expense, treasury, journal | Same | Activity/file |
| Stock approval | `stockAdjustmentsController.js:340`: request, movement/journal, state | Same | Event/reorder/activity |
| **Direct adjustment** | `applyStockMovement` owns transaction; request inserted later | **Early movement commit; no joint rollback** | Request/activity |
| Warranty replacement | `warrantyService.js:618`: claim, invoice/items, stock, warranties | Same | Event; leaked activity; missing journal |
| Treasury transfer | Controller transaction: both legs + transfer row | Same | Activity/event |

## 5. Checkout Atomicity

`web/lib/pos/checkout.ts:99-139` persists/reuses a draft, posts keyed allocations, then confirms. Confirmation locks the invoice (`invoiceService.js:513`), recalculates server totals, requires full allocation, locks/checks variants (`:465-476`), deducts stock (`:568`), updates credit, posts each cash/bank leg and journals, then sets confirmed/history.

If a later stock line, treasury posting, closed-period check, or journal insert fails, earlier confirm writes use the same client and roll back. Previously committed draft/allocations remain truthfully pending. No success response precedes core commit.

Prices/discounts/VAT are server-persisted. COGS uses `cost_price_at_time` (`invoiceService.js:280-294`, `:661-670`), a current-cost snapshot rather than FIFO. Confirm lacks a command key; a lost post-commit response yields unknown outcome and retry returns “not draft.” Warranties and PDF/print occur later.

**Verdict: PARTIAL.** Financial confirmation is code-supported atomic; end-to-end retry, FIFO, warranty, and audit completeness are not.

## 6. Payment Atomicity

Invoice allocation (`invoicePaymentsController.js:57-142`) locks the draft, checks the key, inserts payment, recalculates, and writes history on one client. Migration 025 uniquely indexes `(invoice_id,idempotency_key)`. Cash/bank/credit legs gain effect together during confirm. Positive remaining balance blocks confirmation, so a “partial” checkout must assign the rest to customer credit.

Customer collection (`customerService.js:52-169`) locks customer and atomically inserts payment, reduces debt, moves cash/bank, posts receivable journal, and logs with the same client. Void archives and reverses in one transaction. Supplier payment and expense also coordinate their financial DB writes.

Those later commands lack idempotency. A response-loss retry can post twice while balance remains. Collections reduce aggregate customer debt rather than specific invoices. Supplier cheque reduces PO balance but has no clearing state/journal until later; no clearing workflow was found.

No external card terminal/gateway exists. “Bank” is only an internal account posting, so external capture, pending settlement, webhook, refund, and reconciliation are **NOT IMPLEMENTED**.

## 7. Inventory & FIFO Atomicity

`stockService.applyStockMovement` locks the variant (`stockService.js:122-128`), validates quantity, updates stock/quarantine, inserts movement, and for adjustments posts journal on the caller's client. This protects the last-unit race for compliant writers.

Weaknesses: no DB nonnegative-stock check; direct adjustment split commit; no location balances/transfer; and no FIFO layers. PO receipt records cost history then overwrites current cost; sale snapshots that current cost. Therefore multi-layer exhaustion, rollback, returns-to-layer, and FIFO COGS cannot be evaluated.

**Verdict: FIFO and inventory transfer NOT IMPLEMENTED.** Ordinary stock movement atomicity is mostly **PASS**, except direct adjustment.

## 8. Shared Cash Drawer Atomicity

`cashService.postTransactionWith` locks the singleton drawer (`cashService.js:47-61`), calculates from the locked balance, rejects outgoing negative results (`:242-250`), inserts the ledger row (`:252-272`), and updates balance (`:274-282`) on one client.

With AED 200, concurrent AED 150 refund and expense serialize: the first retains the lock; after it commits AED 50, the second fails. If the first rolls back, the second may succeed. Card/bank and credit tenders do not touch physical cash.

Residual issues: no DB nonnegative check; no command idempotency; auto-open can silently mutate drawer state; manual cash/bank and transfers do not post the GL; open/close activity is outside the parent transaction.

**Verdict: PASS** for service-level ledger/balance atomicity and overspend locking; **PARTIAL** for retry, audit, constraints, and GL reconciliation.

## 9. Returns & Refunds

`returnService.approveAndExecute` locks the request (`returnService.js:731-746`) and atomically creates order/items, applies disposition, voids item warranties, restores inventory value, creates refund legs, updates customer/cash/bank, posts revenue/VAT/inventory journals, creates any replacement, and updates request/history.

Disposition is explicit: good → stock; defective → stock then quarantine; disposed → no sellable-stock increase; supplier return → stock out and payable/inventory/input-VAT reversal. A required failure rolls back all execution writes. State lock prevents two approvals of one request; creation logic reserves refundable quantity.

Activity calls leak and request creation emits/notifies before commit. No create-command idempotency exists.

**Verdict: PASS** core; **PARTIAL** audit/event/retry.

## 10. Purchase Orders & Supplier Operations

PO create/edit bundle header/items/totals. Confirm locks the draft. Receipt (`purchaseOrderService.js:102-302`) locks PO and lines and coordinates stock/movement, received quantities, cost history/current cost, input VAT, status, and inventory/payables journal. Mid-loop failure rolls back earlier lines.

Remaining-quantity/state validation protects over-receipt races, but a response-loss replay of a partial receipt may be accepted again. Supplier payment locks the PO and atomically updates payment/balance/treasury/journal, but lacks a key. No supplier-invoice entity, FIFO layer creation, or committed-PO cancellation exists.

**Verdict: PASS** for one request; **PARTIAL** retry/correction; required FIFO/cancellation **NOT IMPLEMENTED**.

## 11. Expenses & Financial Postings

Expense creation (`expenseService.js:83`) inserts expense, cash/bank debit, and balanced journal in one transaction. Same-day delete reverses treasury/journal and deletes source on one DB client.

The optional receipt is saved after financial commit (`expensesController.js:55-73`). Delete removes the receipt file before DB delete/commit (`expenseService.js:383-391`). A later DB failure leaves a live row pointing to a deleted file; pointer failure can leave an orphan upload. Manual treasury changes also omit journals, so treasury and GL reports can diverge.

**Verdict: PASS** financial DB bundle; **PARTIAL** retry/files/GL.

## 12. Transaction Context Leakage

| Evidence | Leakage | Status |
|---|---|---|
| `stockAdjustmentsController.js:218-263` | Direct movement commits before request insert | **FAIL** |
| `activityLog.js:11-39` | No-client call autocommits and swallows error | **PARTIAL** |
| `expenseService.js:150-157`, `:393-403` | Activity inside parent callback lacks client | **FAIL** audit |
| `cashService.js:384-391`, `:513-528` | Open/close activity lacks client | **FAIL** audit |
| `returnService.js:673-680`, `:1199-1218` | Return activity lacks client | **FAIL** audit |
| `warrantyService.js:191-198`, `:742-749`, `:790-797` | Warranty activity lacks client | **FAIL** audit |
| Parent `returnService.js:585`; events `:686-720` | Request socket/notification before commit | **FAIL** |
| Warranty transactions `:102`, `:247`, `:399`; events `:202-211`, `:287-297`, `:472-488` | Same phantom-event risk | **FAIL** |
| `invoiceService.js:809-825`, `:1069-1078` | Warranty create/void is post-commit and errors swallowed | **PARTIAL** |
| `invoiceService.js:827-859` | PDF/print fire-and-forget after commit | **PASS** as regenerable non-authoritative work |

No unsafe dependent `Promise.all` was found in the main transaction callbacks. Most confirmation/execution balance events are correctly deferred.

## 13. Concurrency & Isolation

| Scenario | Mechanism/result | Minimum correct mechanism |
|---|---|---|
| Last unit | Invoice/variant locks; **PASS** by code/test design | Keep locks; DB stock check; keyed confirm |
| Same return | Request lock/state; **PASS** | Keep; unique logical return identity |
| Customer payments | Customer lock prevents lost balance; duplicate retry remains | Lock + operation key |
| FIFO | **NOT IMPLEMENTED** | Lock oldest layers in deterministic order |
| Drawer debits | Singleton lock; **PASS** service writers | Lock + DB check + key |
| PO receive | PO/line locks; **PASS** race, retry partial | Locks + key |
| Price edit at checkout | Persisted server-resolved line protects confirm | Catalog/version evidence + invoice version |
| Active stock count creation | Precheck then insert, no DB singleton | Advisory lock or unique/exclusion constraint |
| Concurrent draft edits | Lock serializes, but last writer wins | Optimistic `version` compare-and-swap |

`READ COMMITTED` is adequate for these locked aggregates; universal SERIALIZABLE is unnecessary. Deterministic lock order, uniqueness, and targeted locks are required.

## 14. Network Failure & Unknown Outcomes

| Timing | Outcome | Current client knowledge/recovery |
|---|---|---|
| Before server receipt | No mutation | Unknown whether sent; retry safe only where keyed |
| During pre-commit work | Transaction normally aborts | Timeout/disconnect; no durable receipt |
| After commit before response | Mutation committed | Timeout; most retries duplicate, confirm returns invalid state |
| Backend crash pre/post commit | DB rollback or durable commit | Indistinguishable without lookup |
| Connection loss | Open transaction normally aborts | No retry policy; rollback error may mask cause |
| Refresh/double-click | Multiple requests | UI guard is not durable; only allocation has DB key |

A timeout is **UNKNOWN**, never proof of rollback. Required: client operation ID, request fingerprint, unique constraint, durable status/result committed with business data, and lookup/replay endpoint.

## 15. Audit Log Consistency

Migration 038 makes `activity_log` append-only. `logActivity` is transactional only when passed `client`; customer collect/void does this correctly. Many others do not, so success logs can commit before parent failure or fail silently after business success. No universal correlation ID joins request, source, treasury, journal, error, and external work. Rollback failure is not separately captured. Swallowed warranty/PDF/notification errors often produce console output but no durable reconciliation item.

**Verdict: PARTIAL.** Diagnostic and authoritative audit semantics are mixed.

## 16. Database Constraints

Present: PK/FK relationships, unique document/journal numbers, unique invoice allocation key, singleton drawer, and per-journal-line debit-or-credit check.

Missing/insufficient: positive amount/quantity checks; constrained status/method/direction values; nonnegative stock/drawer checks; payment-total versus source-total checks; received ≤ ordered; whole-journal balance enforcement; unique source posting roles for journal/cash/bank; most command keys; one-active-count enforcement; all FIFO invariants.

**Verdict: FAIL** for independent defense in depth.

## 17. Existing Test Coverage

Tests inspected, **NOT RUN**:

- Static locks/wrapper: `tests/contracts/concurrency.locks.test.js:17-58`.
- Opt-in real last-unit race: `concurrency.live.test.js:57-150`.
- Closed-period rollback: `invoiceIntegrity.test.js:138`.
- Keyed allocation replay/race: `invoiceIntegrity.test.js:164-193`.
- Credit-limit race: `invoiceIntegrity.test.js:258`.
- Return reservation/plans/refunds: `invoiceIntegrity.test.js:245-331`; `refundJournal.test.js:100`.
- PO lifecycle/VAT: `purchaseOrders.test.js:98-147`; `purchaseVat.test.js:140-194`.
- Stock-count rebase: `stockCountRebase.test.js:115-165`.

Missing: direct-adjustment split failure; concurrent drawer refund/expense; response-loss retry for collection/supplier/expense/PO; file failure; phantom events; warranty recovery/accounting; connection loss and rollback failure; source-posting uniqueness; concurrent count creation; FIFO/transfer.

## 18. Safe Failure Injection Test Plan

Use only a disposable synthetic DB/filesystem, isolated from production.

| ID | Initial state and operation | Injection | Expected final state/assertions |
|---|---|---|---|
| FI-01 | Draft, two items, exact split; confirm | After first stock move | Draft; all stock unchanged; no movements/treasury/journal/debt/confirm history |
| FI-02 | Same, open period | Journal failure after treasury | Full rollback across source/stock/customer/treasury/journal |
| FI-03 | Drawer AED 200; concurrent AED 150 refund + expense | Two connections | Exactly one commit, balance AED 50, one source/ledger row |
| FI-04 | Debt AED 500; collect AED 100 | Drop response after commit; replay key | One payment, debt AED 400, same result ID |
| FI-05 | PO ordered 10/received 0; receive 4 | Drop post-commit response; replay | Received 4, one stock/journal posting |
| FI-06 | Direct adjustment | Fail request insert | No stock/movement/journal/request change |
| FI-07 | Multi-line return | After first disposition/refund | Request pending; no order/items/stock/refund/treasury/journal |
| FI-08 | Expense with receipt | DB failure after cleanup point | Row and referenced file both remain |
| FI-09 | Warranty-bearing sale | Fail warranty worker | Sale committed; durable failed/pending job; retry creates once |
| FI-10 | FIFO layers 1@A, 2@B; sell 3 | Second layer update | Layers, stock, invoice, COGS unchanged |
| FI-11 | No active count; two initiations | Concurrent inserts | Exactly one active count |
| FI-12 | Any keyed command | Disconnect during commit acknowledgement | Status lookup resolves; replay never duplicates |

Collect operation ID, transaction ID, SQLSTATE, request/response, row snapshots, balanced journal totals, and outbox/file state.

## 19. Data Integrity Invariants

| Invariant | Status |
|---|---|
| Confirmed invoice has valid items/server totals | **PASS** service; **PARTIAL** DB |
| Confirmed catalog sale has required stock changes | **PASS** core |
| Exactly one required sale posting set | **PARTIAL**; no source-role uniqueness/keyed confirm |
| Payment source/balance/treasury/journal move together | **PASS** core; replay uniqueness **FAIL** broadly |
| No duplicate logical settlement | **FAIL** |
| No negative stock/cash | **PARTIAL** service locks/checks; no DB check |
| Customer debt is consistent | **PARTIAL** aggregate, no per-invoice allocation constraint |
| No partial FIFO after failed sale | **NOT IMPLEMENTED** |
| No duplicate return quantity/value | **PASS/PARTIAL** service reservation; limited DB enforcement |
| Completed receipt has matching stock/accounting | **PASS** core |
| Warranty replacement changes stock/value together | **FAIL** |
| Audit success implies source commit | **FAIL** |
| Required external work is complete or durably pending | **FAIL** |
| No success response before authoritative commit | **PASS** core |

## 20. Confirmed Findings

### TXA-001 — Direct stock adjustment split commit

- **Severity / operation:** CRITICAL — direct adjustment
- **File/lines:** `server/controllers/stockAdjustmentsController.js:214-263`; `server/services/stockService.js:266-273`
- **Tables:** variants, movements, journal entries/lines, adjustment requests
- **Boundary evidence:** movement receives no client, owns/commits transaction; request insert follows via autocommit.
- **Failure / expected / actual:** request insert fails; expected all rollback; actual stock/journal remain without authorization and retry can repeat.
- **Impact:** unexplained inventory/GL variance and duplicate correction.
- **Correction:** one outer client, locked recheck, unique operation key, post-commit events.
- **Verification / confidence:** FI-06 and count race; **HIGH**.

### TXA-002 — FIFO absent

- **Severity / operation:** CRITICAL — receipt/sale/return/COGS
- **File/lines:** `invoiceService.js:280-294`, `:661-670`; `purchaseOrderService.js:190-222`; no layer schema/service
- **Tables:** variants/items/cost history/journals; required layers absent
- **Boundary evidence:** no layer transaction exists.
- **Failure / expected / actual:** mixed-cost sale; expected oldest locked layers; actual current-cost snapshot.
- **Impact:** incorrect COGS, margin, assets, and return valuation.
- **Correction:** immutable receipt layers and transactional consumption with constraints.
- **Verification / confidence:** FI-10; **HIGH**.

### TXA-003 — Missing command idempotency

- **Severity / operation:** HIGH — most money/stock commands
- **File/lines:** protected allocation `invoicePaymentsController.js:54-118`; absent in `customerService.js:26-169`, `supplierPaymentService.js:29-176`, `expenseService.js:57-198`, `purchaseOrderService.js:93-302`
- **Tables:** corresponding sources, stock, treasury, journals
- **Boundary evidence:** each retry starts a new atomic transaction without logical identity.
- **Failure / expected / actual:** response lost; expected original result; actual second posting can commit.
- **Impact:** duplicate collection/payment/expense/receipt/movement.
- **Correction:** required key + fingerprint + unique DB index + status/result replay.
- **Verification / confidence:** FI-04/05/12; **HIGH**.

### TXA-004 — Warranty state is outside sale/cancel commit

- **Severity / operation:** HIGH — confirmation/cancellation warranty
- **File/lines:** `invoiceService.js:809-825`, `:1069-1078`
- **Tables:** invoices, warranties/claims
- **Boundary evidence:** later transaction; error swallowed.
- **Failure / expected / actual:** warranty step fails; expected atomic or durable pending; actual confirmed sale lacks warranty or cancelled sale retains it.
- **Impact:** entitlement inconsistency.
- **Correction:** same transaction or transactional outbox/reconciliation.
- **Verification / confidence:** FI-09 plus cancellation; **HIGH**.

### TXA-005 — Warranty replacement lacks journal

- **Severity / operation:** HIGH — claim replacement
- **File/lines:** `warrantyService.js:618-797`, stock at `:673-687`; builder `:496-600` has no journal call
- **Tables:** claim/warranty/invoice/stock; expected journal missing
- **Boundary evidence:** rows/stock atomic, accounting write absent.
- **Failure / expected / actual:** successful replacement; expected inventory credit + warranty expense/COGS; actual quantity only.
- **Impact:** GL inventory/profit overstated.
- **Correction:** balanced valuation entry in claim transaction.
- **Verification / confidence:** reconcile quantity/value after replacement; **HIGH**.

### TXA-006 — Audit transaction context leakage

- **Severity / operation:** HIGH — expenses, cash, returns, warranties
- **File/lines:** `activityLog.js:11-39`; examples `expenseService.js:150-157`, `cashService.js:384-391`, `returnService.js:1199-1218`, `warrantyService.js:742-749`
- **Tables:** activity log and described sources
- **Boundary evidence:** missing client uses independent pool query; error swallowed.
- **Failure / expected / actual:** parent later fails or audit fails; expected matching outcomes; actual false/missing success evidence.
- **Impact:** unreliable accountability.
- **Correction:** client for mandatory audit; outbox/correlation ID for integrations.
- **Verification / confidence:** fail after audit and fail audit itself; **HIGH**.

### TXA-007 — Pre-commit external events

- **Severity / operation:** HIGH — return/warranty create
- **File/lines:** parent `returnService.js:585`, events `:686-720`; warranty transactions `:102/:247/:399`, events `:202-211/:287-297/:472-488`
- **Systems:** source/notification tables and Socket.IO
- **Boundary evidence:** event before transaction promise resolves.
- **Failure / expected / actual:** commit fails after event; expected no delivery; actual phantom event possible.
- **Impact:** action on nonexistent request.
- **Correction:** transactional outbox, post-commit dispatcher.
- **Verification / confidence:** forced commit failure; **HIGH**.

### TXA-008 — File/DB boundary is not atomic

- **Severity / operation:** HIGH — expense and attachment create/delete
- **File/lines:** `expensesController.js:55-73`; `expenseService.js:383-391`
- **Tables/systems:** expense receipt path and filesystem
- **Boundary evidence:** receipt saved after financial commit; delete file before DB commit.
- **Failure / expected / actual:** pointer/commit fails; expected valid pointer or recoverable pending; actual orphan or broken pointer.
- **Impact:** lost audit evidence.
- **Correction:** staged immutable files, transactional pointer/outbox, post-commit cleanup.
- **Verification / confidence:** FI-08 variants; **HIGH**.

### TXA-009 — Ambiguous confirmation outcome

- **Severity / operation:** MEDIUM — checkout confirm
- **File/lines:** `web/lib/pos/checkout.ts:117-139`; `invoiceService.js:510-531`
- **Tables:** complete sale set
- **Boundary evidence:** commit may precede response loss; retry only accepts draft.
- **Failure / expected / actual:** disconnect after commit; expected lookup/replay success; actual invalid-state retry/manual inference.
- **Impact:** cashier uncertainty and duplicate actions.
- **Correction:** keyed confirm + status endpoint.
- **Verification / confidence:** FI-12; **HIGH**.

### TXA-010 — Manual treasury bypasses GL

- **Severity / operation:** MEDIUM — manual cash/bank and transfers
- **File/lines:** `cashService.js:568-600`; `bankAccountsController.js:118-188`, `:210-327`
- **Tables:** treasury tables; missing journal rows
- **Boundary evidence:** subledger atomic, journal absent.
- **Failure / expected / actual:** adjustment commits; expected balanced offset/transfer; actual GL unchanged.
- **Impact:** subledger/financial-report mismatch.
- **Correction:** defined accounting entry in same transaction.
- **Verification / confidence:** source-to-journal reconciliation; **HIGH**.

### TXA-011 — Database invariants insufficient

- **Severity / operation:** MEDIUM — all critical writers
- **File/lines:** migrations 002/004/006/009/010/013; `concurrency.locks.test.js:47-51`
- **Tables:** core inventory/financial tables
- **Boundary evidence:** service checks are not database enforcement.
- **Failure / expected / actual:** alternate writer inserts impossible state; expected DB rejection; current schema accepts many such states.
- **Impact:** silent corruption/regression.
- **Correction:** checks/domains, source-role uniqueness, journal balancing, active-count guard.
- **Verification / confidence:** negative constraint tests; **HIGH**.

### TXA-012 — Explicit inactive bank account accepted

- **Severity / operation:** MEDIUM — all bank postings
- **File/lines:** `server/services/bankService.js:76-108`
- **Tables:** bank account/transactions plus source/journal
- **Boundary evidence:** explicit-ID locked lookup lacks active check; fallback filters active.
- **Failure / expected / actual:** stale client selects inactive ID; expected rejection; actual atomic posting succeeds.
- **Impact:** reconciliation against closed account.
- **Correction:** active check under lock, with deliberate reversal-only exception.
- **Verification / confidence:** all posting types against inactive ID; **HIGH**.

## 21. Unverified Risks

**NOT TESTED:** real PostgreSQL durability/timeouts; crash/TCP-reset/disk-full/restart behavior; global deadlock graph; multi-process socket ordering; error-middleware durability/redaction; filesystem helper atomicity; production duplicates/negative balances/orphans/reconciliation; real browser/proxy retries. Card gateway is absent. FIFO/transfer cannot be tested until implemented.

## 22. Prioritized Recommendations

1. Unify direct adjustment and add its operation key.
2. Implement FIFO layers/consumption or formally remove FIFO from requirements.
3. Add durable idempotency/status lookup to every critical command.
4. Add warranty replacement accounting and sale/cancel warranty outbox.
5. Make mandatory audit transactional; dispatch external effects from outbox.
6. Stage files and clean them only after committed pointer changes.
7. Add DB checks, source-posting uniqueness, and one-active-count guard.
8. Journal manual treasury operations in their source transaction.
9. Add committed-PO reversal/cancellation workflow.
10. Reject inactive bank accounts; use deterministic locks and bounded retry after idempotency.
11. Pass the isolated Section 18 suite and reconcile all source/stock/treasury/customer/tax/journal balances.

## 23. Production Readiness Verdict

**FAIL / NOT TESTED for complete production readiness.** Core locked transaction composition is solid enough to justify further isolated validation, but the critical direct-adjustment defect, absent FIFO/transfer, widespread retry ambiguity, warranty accounting/recovery gaps, and audit/file/event leakage must be resolved first.

### Final Questions

1. **Are checkout operations atomic?** **PARTIAL:** core confirm yes; staged/post-commit/retry scope no.
2. **Can a completed invoice lack required stock changes?** Normal catalog confirm: code says no. Custom lines intentionally have none; FIFO/warranty completeness remains.
3. **Can payment exist without correct invoice update?** Draft allocation intentionally can. Confirm coordinates it; later collections are aggregate. Duplicate retries remain.
4. **Can a failed sale leave partial FIFO?** FIFO is **NOT IMPLEMENTED**; ordinary stock should roll back.
5. **Can concurrent cash operations make drawer negative?** Compliant service writers: code says no due to row lock. Alternate writers/retries lack DB protection.
6. **Are refunds/returns atomic?** Core execution **PASS**; audit/event/idempotency **PARTIAL**.
7. **Can receiving partially change stock?** A failed single request should roll back; unknown-response replay can duplicate a valid partial receipt.
8. **Do all intended queries share context?** **NO:** direct adjustment, activity, warranty post-work, notifications, and files do not.
9. **Are errors rolled back?** Required same-client errors usually are; swallowed/external failures are not.
10. **Can swallowed exceptions cause partial results?** **YES**, notably warranty/audit/notification/file-adjacent outcomes.
11. **Can two cashiers cause inconsistency?** Core stock/drawer locks help, but unkeyed retries, count creation, and absent FIFO prevent a universal no.
12. **Can timeouts create unknown outcomes?** **YES.**
13. **Can retries duplicate financial postings?** **YES**, except keyed invoice allocations and state-limited cases.
14. **Are DB constraints sufficient?** **NO.**
15. **Are failures accurately logged?** **PARTIAL/NO** for authoritative audit guarantees.
16. **Which operations have verified rollback tests?** Test source covers closed-period invoice rollback and targeted races; none were run/verified by this audit.
17. **Which remain unverified?** Drawer race, retry/crash cases, direct adjustment injection, files/events/warranty recovery, FIFO/transfer.
18. **Highest priorities?** TXA-001, FIFO, idempotency, warranty accounting/recovery, audit/event/file boundaries.
19. **Safeguards before production?** Unified transactions, FIFO, keys/status, outbox, constraints, complete GL, isolated failure/concurrency proof.
20. **Safe for concurrent multi-cashier use?** **Not across the complete required scope.** Ordinary core paths are promising; the documented gaps block approval.
