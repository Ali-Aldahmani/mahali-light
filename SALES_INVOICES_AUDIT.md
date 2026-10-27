# Bytecra POS — Sales & Invoices Audit

**Audit date:** 2026-10-26  
**Scope:** Next.js POS and cashier flows, Express invoice/payment/edit APIs, PostgreSQL schema and transaction behavior  
**Method:** Read-only source review, static transaction/race analysis, and existing isolated tests. No source, configuration, or database data was changed. No production database was contacted.

## Executive summary

The core sale-confirmation path is substantially protected: the API recalculates catalog prices, discounts, VAT, payment totals, stock, customer credit, treasury postings, and journals inside one PostgreSQL transaction. Invoice rows, stock rows, customer credit rows, cash drawers, and bank accounts are locked during their critical mutations. Checkout IDs and payment idempotency keys have database uniqueness enforcement. The tested frontend recovery path preserves an uncertain sale rather than blindly creating a duplicate.

The audit nevertheless found **seven failed controls**. The most serious is an approval-state race: edit rejection is a non-transactional read followed by an unconditional update, so it can race approval and mark an edit request “rejected” after its financial changes were committed. Cashiers also have no ownership boundary around drafts; any cashier with the default `invoice.create`/`invoice.view` permissions can alter, pay, or confirm another cashier's known draft. Payment tender modeling is insufficient for financial reconciliation: card and bank transfer are combined, checks are unsupported, and the POS does not select a bank account, causing all such receipts to fall silently into the default/first active account.

Other verified weaknesses are uncapped invoice-level discounts, incomplete database constraints for financial state, optional cancellation reasons, and silent cash-drawer auto-opening. A further concurrency risk—non-deterministic multi-row stock lock order—was identified statically; PostgreSQL will roll back a deadlock, but the path has no deadlock retry and was not exercised against an isolated database in this run.

No Critical finding was verified. The audit identified **2 High, 5 Medium, and 1 Low failed or untested control**, alongside six verified PASS controls. PostgreSQL integration suites exist and are well targeted, but 51 such tests were skipped because the isolated test-database environment variable was unavailable; their presence is not treated as proof of runtime behavior.

## Findings table

| ID | Severity | Status | Feature | Result |
|---|---|---|---|---|
| SI-01 | High | FAIL | Edit approval/rejection | Rejection can race approval and overwrite the workflow status after financial edits commit. |
| SI-02 | High | FAIL | Multi-cashier isolation | Default cashiers can mutate and confirm any known draft; ownership is not enforced. |
| SI-03 | Medium | FAIL | Card, transfer, and check payments | Card/transfer are conflated, checks are absent, and bank receipts silently select a default account. |
| SI-04 | Medium | FAIL | Discounts and totals | Invoice-level discount can exceed merchandise value and is persisted unreconciled. |
| SI-05 | Medium | FAIL | PostgreSQL integrity constraints | Financial equations, statuses, tender types, and several nonnegative values are not DB-enforced. |
| SI-06 | Medium | FAIL | Cash drawer control | A cash sale silently opens a closed drawer/session instead of requiring an explicit opening control. |
| SI-07 | Low | FAIL | Cancellation audit trail | A privileged cancellation can be committed without a reason. |
| SI-08 | Medium | NOT TESTED | Multi-item lock ordering | Opposite variant lock orders can deadlock; rollback is safe, but retry behavior was not live-tested. |
| SI-09 | High | PASS | Sale/payment idempotency | Checkout and payment duplication are guarded in API logic and PostgreSQL uniqueness constraints. |
| SI-10 | High | PASS | Confirmation atomicity | Stock, customer credit, treasury, journal, status, history, and warranties share one transaction. |
| SI-11 | High | PASS | Stock and credit concurrency | Row locks prevent overselling and concurrent credit-limit overrun. |
| SI-12 | Medium | PASS | Pricing, VAT, and rounding | Server-authoritative catalog price, VAT snapshot, permission checks, and cent rounding are implemented. |
| SI-13 | High | PASS | Cancellation consistency | Confirmed cancellation reverses original stock, treasury, credit, journal, and warranties atomically. |
| SI-14 | Medium | PASS | Interrupted checkout recovery | A stable checkout ID is persisted and queried after timeout/lost response before retrying. |

## Detailed findings

### SI-01 — Approval and rejection can commit contradictory results

- **Severity:** High
- **Status:** FAIL
- **Verification:** Verified by code and transaction interleaving analysis; not executed against a database.
- **Feature:** Invoice edit/correction approval workflow.
- **Location:** `server/services/invoiceService.js:1130` (`applyEditRequest`), `server/services/invoiceService.js:1493` (`rejectEditRequest`), `server/services/invoiceService.js:1511` (unconditional rejection update), `server/controllers/invoiceEditRequestsController.js:194` (`approve`), `server/controllers/invoiceEditRequestsController.js:214` (`reject`).
- **Expected behavior:** Exactly one reviewer decision should win. Approval and rejection must serialize on the edit-request row, and the final request state must agree with whether item, stock, and journal changes were applied.
- **Actual behavior:** Approval locks `invoice_edit_requests ... FOR UPDATE` and performs edits transactionally. Rejection first reads status without a lock, then executes an unconditional `UPDATE ... SET status = 'rejected'` outside a transaction. A reject request can read `pending`, pause, allow approval to commit all financial edits and `approved`, then overwrite only the request state to `rejected` and append a rejection history event.
- **Evidence:** Approval locks and checks pending at lines 1133–1150 and commits financial changes plus `approved` at lines 1385–1405. Rejection reads at lines 1494–1509, updates without `WHERE status = 'pending'` at lines 1511–1519, and writes history separately at lines 1521–1525.
- **Safe reproduction:** In an isolated test database, create one pending request. Pause rejection after its initial `SELECT`; approve the same request in a second connection; resume rejection. Verify that invoice/stock/journal edits exist while the request ends as `rejected`. Do not run this against production.
- **Root cause:** The reject path lacks a transaction, row lock, and compare-and-set predicate.
- **Recommended fix:** Run rejection in `withTransaction`, select the request `FOR UPDATE`, re-check `pending`, and update with `WHERE id = $1 AND status = 'pending'`, requiring exactly one affected row. Put request status, invoice history, and activity log in the same transaction. Add concurrent approve-vs-reject and reject-vs-reject tests.

### SI-02 — Draft invoices are not isolated between cashiers

- **Severity:** High
- **Status:** FAIL
- **Verification:** Verified by route and controller authorization analysis.
- **Feature:** Multi-cashier draft ownership, payment attribution, and confirmation.
- **Location:** `shared/permissions.js:188` (`ROLE_DEFAULTS.Cashier`), `server/routes/invoices.js:16` (`GET /`), `server/routes/invoices.js:20` (`PUT /:id/items`), `server/routes/invoices.js:21` (`POST /:id/confirm`), `server/routes/invoices.js:24`–`26` (payment routes), `server/controllers/invoicesController.js:178` (`list`), `server/controllers/invoicesController.js:525` (`updateItems`), `server/controllers/invoicePaymentsController.js:52` (`create`).
- **Expected behavior:** Concurrent cashier drafts should either be explicitly shared/claimed or restricted to their creator/assigned terminal. A cashier should not be able to change another cashier's items, customer, payment allocation, or confirmation attribution merely by knowing the invoice UUID.
- **Actual behavior:** The default Cashier role has both `invoice.view` and `invoice.create`. Listing is not scoped to `created_by`; all draft mutation routes require only `invoice.create`; and controllers lock by invoice ID but never compare `created_by`, `pc_identifier`, or a claim/ownership token to the current user. Consequently, a cashier can discover and mutate another cashier's draft. `confirmed_by` becomes the second cashier while `created_by` remains the first.
- **Evidence:** Cashier permissions at `shared/permissions.js:188`–`199`; global list query at `server/controllers/invoicesController.js:178`–`275`; mutation route gates at `server/routes/invoices.js:20`–`26`; update row lock/status checks omit ownership at `server/controllers/invoicesController.js:533`–`559`; payment lock/status checks omit ownership at `server/controllers/invoicePaymentsController.js:60`–`93`.
- **Safe reproduction:** In an isolated database, authenticate two Cashier users. User A creates a draft. User B lists invoices, then changes A's draft, adds a payment, and confirms it using the returned UUID. Verify all operations are accepted and inspect `created_by` versus `confirmed_by`.
- **Root cause:** RBAC is operation-wide and has no row-level draft authorization policy.
- **Recommended fix:** Define an explicit draft ownership model (`created_by`, terminal, or claim/transfer record). Enforce it in every draft read/mutation query while allowing narrowly authorized manager takeover. Use SQL predicates as well as controller checks, and audit transfer/takeover events.

### SI-03 — Payment channels are not independently traceable

- **Severity:** Medium
- **Status:** FAIL
- **Verification:** Verified by frontend/API/schema trace; no payment processor integration was present.
- **Feature:** Cash, card, bank transfer, and check payments.
- **Location:** `web/components/cashier/CashierPaymentDialog.tsx:11` (`METHODS`), `server/controllers/invoicePaymentsController.js:10` (`createSchema`), `server/controllers/invoicePaymentsController.js:109` (payment insert), `server/services/invoiceService.js:642` (treasury posting), `server/services/bankService.js:80` (`resolveAccount`), `server/db/migrations/006_invoices.sql:54` (`invoice_payments`).
- **Expected behavior:** Card, bank transfer, and check should be distinct tender types with their own required references and lifecycle fields. Bank-like payments should post to the selected settlement/account destination; checks require number, bank, due date, and clearing/bounce state.
- **Actual behavior:** The UI offers only Cash, “Card / Bank,” and Customer credit. The API accepts only `cash`, `bank`, and `credit`; check is absent. `bankAccountId` is optional, the cashier UI does not collect it, and `resolveAccount` silently selects the default or first active account. Card authorization/acquirer/terminal/reference and check clearing data are not stored. PostgreSQL stores a free-form method string but the API cannot represent the requested channels.
- **Evidence:** UI methods at lines 11–15; API enum and optional account at `invoicePaymentsController.js:10`–`16`; confirmation passes null account at `invoiceService.js:660`–`670`; fallback account selection at `bankService.js:102`–`116`; base table comment lists only cash/bank/credit at `006_invoices.sql:54`–`63`.
- **Safe reproduction:** In a non-production environment, open Take payment and verify no independent card, transfer, or check tender exists and no bank account/reference is requested. Submit a `bank` allocation without `bankAccountId`; with multiple active accounts, confirm it posts to the default/oldest active account.
- **Root cause:** The tender domain model collapses materially different settlement instruments into one bank bucket.
- **Recommended fix:** Introduce explicit tender types and channel-specific validated metadata. Require an account/clearing destination for non-cash settlement, record immutable processor/reference details, model check states, add DB constraints, and retain exact reversal linkage.

### SI-04 — Invoice-level discounts can exceed the sale value

- **Severity:** Medium
- **Status:** FAIL
- **Verification:** Verified by source and read-only function execution.
- **Feature:** Discounts, VAT, rounding, and totals.
- **Location:** `web/components/cashier/CashierCart.tsx:147` (discount input), `server/controllers/invoicesController.js:407` (`createSchema`), `server/services/invoiceService.js:87` (`computeTotals`), `server/services/invoiceService.js:350` (`assertInvoiceDiscountAllowed`), `server/services/invoiceService.js:430` (`recalculateAndPersistTotals`).
- **Expected behavior:** Total discount should not exceed the eligible item value after line discounts. Stored `discount_amount`, `invoice_discount`, taxable amount, and total should remain arithmetically reconcilable.
- **Actual behavior:** Input and API validation enforce only nonnegative discount. `computeTotals` clamps taxable amount to zero but does not cap the stored discount. If no pricing restriction applies, `assertInvoiceDiscountAllowed` does not reject it. A subtotal of AED 100 with an invoice discount of AED 1,000 produces `discountAmount: 1000`, `taxableAmount: 0`, `total: 0`, and `paymentStatus: paid`.
- **Evidence:** Read-only execution output: `{"subtotal":100,"discountAmount":1000,"invoiceDiscount":1000,"taxableAmount":0,"taxRate":5,"taxAmount":0,"total":0,"amountPaid":0,"balanceDue":0,"paymentStatus":"paid"}`. Clamping is at `invoiceService.js:96`–`105`; persistence is at lines 430–456. The frontend field has `min=0` but no maximum at `CashierCart.tsx:150`–`158`.
- **Safe reproduction:** Call the exported pure `computeTotals` function with one AED 100 item and `invoiceDiscount: 1000`, or create the equivalent draft only in an isolated database with an authorized price override user.
- **Root cause:** Negative totals are clamped rather than rejecting an excessive invoice-level discount; no invariant caps discount to eligible merchandise value.
- **Recommended fix:** Reject invoice discount above the sum of post-line-discount line totals, both in service validation and a DB-consistent invariant strategy. Display the maximum in the client, but keep the server authoritative.

### SI-05 — PostgreSQL does not enforce a complete invoice invariant set

- **Severity:** Medium
- **Status:** FAIL
- **Verification:** Verified by migration review; installed production constraint state was not queried.
- **Feature:** Database integrity and defense against alternate writers.
- **Location:** `server/db/migrations/006_invoices.sql:3` (`invoices`), `server/db/migrations/006_invoices.sql:34` (`invoice_items`), `server/db/migrations/006_invoices.sql:54` (`invoice_payments`), `server/db/migrations/047_financial_constraints.sql:14` (financial checks).
- **Expected behavior:** PostgreSQL should reject invalid status/tender enums, negative financial amounts, impossible line math, and invoice rows whose subtotal/discount/tax/total/paid/balance relationships do not reconcile.
- **Actual behavior:** Migration 047 adds positive quantity/payment and selected balance checks, plus a deferred balanced-journal trigger. It does not constrain invoice status, payment status, edit-request status, or payment method; nor does it enforce nonnegative invoice/item price/discount/tax fields or invoice/line arithmetic equations. The migration's checks are `NOT VALID`, so historical rows are explicitly not verified until a later manual validation.
- **Evidence:** Free-form `VARCHAR` states/methods and unconstrained money columns at `006_invoices.sql:16`–`28`, `43`–`49`, and `57`–`63`. The complete constraint list at `047_financial_constraints.sql:18`–`39` contains only invoice item quantity and invoice payment amount for this domain; comments at lines 6–9 confirm existing rows are not rechecked.
- **Safe reproduction:** In a disposable migrated database, attempt direct inserts/updates with an unknown payment method/status or inconsistent invoice totals; verify they are accepted while negative invoice payment amount is rejected. Never run against production.
- **Root cause:** Business invariants primarily live in Express services rather than the database boundary.
- **Recommended fix:** Add staged `CHECK` constraints/enums for states and tender types; nonnegative checks for all monetary fields; line-level equations; and a safe database mechanism or controlled write API for invoice total reconciliation. Reconcile and then `VALIDATE CONSTRAINT` for all existing `NOT VALID` checks.

### SI-06 — Cash sales silently open a closed drawer

- **Severity:** Medium
- **Status:** FAIL
- **Verification:** Verified by code.
- **Feature:** Cash payment control and cashier-session accountability.
- **Location:** `server/services/invoiceService.js:649` (cash sale posting), `server/services/cashService.js:174` (`postTransactionWith`), `server/services/cashService.js:207`–`240` (automatic session open).
- **Expected behavior:** A cash sale should require an explicitly opened and assigned drawer/session, with a controlled opening balance and cashier acknowledgement; otherwise confirmation should fail safely.
- **Actual behavior:** Invoice confirmation calls `recordCashIn` with the default `allowAutoOpen`. If no session is open and the drawer is closed, the service silently creates a session at the current balance, labels it “Auto-opened by system,” and continues the sale.
- **Evidence:** Intentional bypass is documented and implemented at `cashService.js:210`–`239`; the transaction is then associated with that new session at lines 255–277.
- **Safe reproduction:** In an isolated database, close the drawer and confirm a fully allocated cash invoice. Verify confirmation succeeds and an auto-opened session is created.
- **Root cause:** Sale availability is prioritized over cash-control enforcement, and the invoice path does not opt out of automatic opening.
- **Recommended fix:** Require an open drawer/session for cash sales by default. If emergency auto-open is retained, require explicit elevated permission, reason, and alert, and record a separately reviewable control exception.

### SI-07 — Cancellation reason is optional

- **Severity:** Low
- **Status:** FAIL
- **Verification:** Verified by code.
- **Feature:** Invoice cancellation approval and auditability.
- **Location:** `server/controllers/invoicesController.js:671` (`cancel`), `server/services/invoiceService.js:890` (`cancelInvoice`), `server/services/invoiceService.js:1027` (cancellation update/history).
- **Expected behavior:** A privileged cancellation that reverses stock, treasury, tax, and journals should require a meaningful reason.
- **Actual behavior:** The controller converts an empty reason to `null`; the service accepts the default null value, commits the cancellation, and writes the generic history text “Cancelled.”
- **Evidence:** Optional parsing at `invoicesController.js:681`; nullable service parameter at `invoiceService.js:890`; persistence at lines 1027–1042.
- **Safe reproduction:** In an isolated database, call `POST /invoices/:id/cancel` with `{}` as a user with `invoice.cancel`; verify the cancellation succeeds and `cancel_reason` is null.
- **Root cause:** No request schema or minimum reason rule exists for cancellation.
- **Recommended fix:** Require and length-limit a trimmed cancellation reason for confirmed invoices, retain actor/timestamp, and consider a controlled reason-code catalog plus free-text detail.

### SI-08 — Multi-variant writers do not define a deterministic lock order

- **Severity:** Medium
- **Status:** NOT TESTED
- **Verification:** Suspected concurrency weakness from static analysis; no isolated PostgreSQL endpoint was available for live race testing.
- **Feature:** Multi-cashier concurrency, retries, and interrupted transactions.
- **Location:** `server/services/invoiceService.js:487` (`findStockShortfalls`), `server/services/invoiceService.js:589` (per-item stock loop), `server/services/invoiceService.js:1211` (edit item loop), `server/services/stockService.js:92` (`applyStockMovement`).
- **Expected behavior:** Transactions touching multiple variants should lock them in one stable global order, or retry PostgreSQL deadlock failures safely.
- **Actual behavior:** Confirmation locks `WHERE id = ANY($1) FOR UPDATE` without `ORDER BY`, then processes invoice item order. Confirmed edit requests call `applyStockMovement` in client-supplied item order. Two transactions touching variants A/B in opposite order can form a lock cycle. PostgreSQL will abort one transaction, preserving integrity, but no deadlock retry is implemented in `withTransaction`.
- **Evidence:** Unordered batch lock at `invoiceService.js:489`–`493`; loops at lines 589–618 and 1211–1256; per-variant `FOR UPDATE` at `stockService.js:121`–`128`; transaction helper performs a single attempt at `server/db/postgres.js:52`–`64`.
- **Safe reproduction:** In a disposable database, concurrently approve or confirm two transactions whose variant arrays are `[A,B]` and `[B,A]`, using barriers to force opposite first locks. Assert one request receives SQLSTATE `40P01`, all its effects roll back, and observe whether the UI offers a safe retry.
- **Root cause:** No canonical variant ordering and no bounded retry policy for serialization/deadlock errors.
- **Recommended fix:** Sort unique variant IDs before acquiring locks and process stock mutations in the same order. Add a bounded retry wrapper for `40P01`/safe `40001` cases around the whole idempotent transaction, with concurrency tests.

### SI-09 — Checkout and payment duplication controls

- **Severity:** High
- **Status:** PASS
- **Verification:** Verified by code, constraints, and passing non-database tests; real PostgreSQL integration tests were skipped.
- **Feature:** Payment idempotency and duplicate invoice prevention.
- **Location:** `web/lib/pos/checkout.ts:129` (`saveDraft`), `server/controllers/invoicesController.js:417` (`create`), `server/controllers/invoicePaymentsController.js:52` (`create`), `server/db/migrations/025_invoice_payment_idempotency.sql:1`, `server/db/migrations/041_invoice_checkout_id.sql:10`.
- **Expected behavior:** Repeated or concurrent submissions for the same sale/payment should produce one invoice/payment and reject reuse with a different payload.
- **Actual behavior:** Checkout creation takes a transaction-scoped advisory lock, returns the existing invoice for a repeated checkout ID, and has a unique partial index. Payment creation locks the invoice, compares any existing idempotency-key payload, and has a unique index on `(invoice_id, idempotency_key)`.
- **Evidence:** `invoicesController.js:424`–`492`; `invoicePaymentsController.js:60`–`125`; migration 025 lines 1–5; migration 041 lines 10–14. Frontend tests covering checkout ID persistence/recovery passed.
- **Safe reproduction:** Existing isolated tests: `tests/integration/checkoutRecovery.test.js:90` and `:102`; `tests/integration/invoiceIntegrity.test.js:164`. They require `INVOICE_TEST_PG_PORT` and were skipped in this run.
- **Root cause:** Not applicable.
- **Recommended fix:** Preserve these controls. Add API-level idempotent result semantics to confirm/cancel as defense in depth, and keep integration tests mandatory in CI.

### SI-10 — Sale confirmation is transactionally atomic

- **Severity:** High
- **Status:** PASS
- **Verification:** Verified by code and passing transaction contract test; database rollback scenarios were skipped.
- **Feature:** Transaction atomicity, rollback, and partial failures.
- **Location:** `server/services/invoiceService.js:532` (`confirmInvoice`), `server/db/postgres.js:52` (`withTransaction`), `server/services/journalService.js:391` (`postSaleEntry`).
- **Expected behavior:** Failure in stock, credit, treasury, journal, status, history, or warranty creation must roll back every preceding sale effect.
- **Actual behavior:** Confirmation holds the invoice lock and performs recalculation, stock movements, credit mutation, cash/bank postings, sale/COGS journal entries, status transition, customer snapshot, history, warranty creation, and activity log through the same transaction client. Socket/PDF side effects occur after commit.
- **Evidence:** `invoiceService.js:533`–`753`; commit/rollback helper at `postgres.js:52`–`64`; journal posting receives the same client at `invoiceService.js:691`–`709`. `tests/contracts/concurrency.locks.test.js` passed, including rollback presence.
- **Safe reproduction:** Existing isolated regression `tests/integration/invoiceIntegrity.test.js:138` closes a financial period and verifies stock/treasury rollback; it was skipped here because no isolated PostgreSQL port was configured.
- **Root cause:** Not applicable.
- **Recommended fix:** Preserve a single transaction boundary and make the database integration suite required in CI.

### SI-11 — Stock and customer-credit races are serialized

- **Severity:** High
- **Status:** PASS
- **Verification:** Verified by code and passing unit/contract tests; live PostgreSQL races were not run.
- **Feature:** Inventory deductions and concurrent credit sales.
- **Location:** `server/services/stockService.js:92` (`applyStockMovement`), `server/services/invoiceService.js:487` (`findStockShortfalls`), `server/services/customerService.js:334` (`assertWithinCreditLimit`).
- **Expected behavior:** Concurrent sales must not oversell stock or both pass against the same remaining customer credit.
- **Actual behavior:** Variant rows are locked before stock calculation/update and negative results are rejected. Customer credit-limit validation locks the customer row, and the balance update occurs before releasing that lock in the outer invoice transaction.
- **Evidence:** Variant `FOR UPDATE` and negative-stock check at `stockService.js:121`–`188`; credit row lock/check at `customerService.js:334`–`367`; confirm uses it at `invoiceService.js:631`–`639`. Stock unit tests and locking contract tests passed.
- **Safe reproduction:** Existing tests: `tests/unit/stockService.test.js:153`; `tests/integration/invoiceIntegrity.test.js:295` for simultaneous credit sales. The latter was skipped here.
- **Root cause:** Not applicable.
- **Recommended fix:** Preserve row locking; address the deterministic multi-variant ordering in SI-08.

### SI-12 — Pricing, VAT, and cent rounding are server-authoritative

- **Severity:** Medium
- **Status:** PASS
- **Verification:** Verified by code and passing unit/frontend tests, subject to SI-04.
- **Feature:** Product price, discounts, VAT, rounding, and totals.
- **Location:** `web/store/posStore.ts:163` (`round2`), `web/store/posStore.ts:202` (`computeLineTotal`), `server/controllers/invoicesController.js:45` (`assertDiscountAuthority`), `server/services/invoiceService.js:36` (`resolveInvoiceTaxRate`), `server/services/invoiceService.js:50` (`money`), `server/services/invoiceService.js:167` (`replaceItems`), `server/services/invoiceService.js:391` (`recalculateAndPersistTotals`).
- **Expected behavior:** The server must distrust client price/tax/total values, consistently round currency, gate price/discount override, and preserve the tax rate stamped on an invoice.
- **Actual behavior:** Catalog lines use current database selling price unless the caller has `invoice.override_price`; discount authority is server-checked; VAT is read from settings only for new invoices; recalculation preserves the stored rate; both frontend and backend round each monetary result to cents with the same epsilon behavior.
- **Evidence:** Unit tests `tests/unit/invoiceService.test.js` (18/18 passed) cover simple/multi-item totals, amount/percent discounts, VAT, partial payments, clamping, and rounding flow. Frontend `web/store/posStore.test.ts` and cashier tests passed. Database regression for catalog-price tampering exists at `tests/integration/invoiceIntegrity.test.js:391` but was skipped.
- **Safe reproduction:** Run the listed pure unit tests; attempt a client-supplied catalog price through an isolated API as Cashier and verify the catalog price is stored.
- **Root cause:** Not applicable.
- **Recommended fix:** Keep server-side authority and add a test rejecting invoice-level discount beyond eligible value.

### SI-13 — Cancellation reverses confirmed financial effects atomically

- **Severity:** High
- **Status:** PASS
- **Verification:** Verified by code; PostgreSQL integration test was skipped.
- **Feature:** Cancellation, stock restoration, and financial consistency.
- **Location:** `server/services/invoiceService.js:890` (`cancelInvoice`), `server/services/journalService.js:490` (`reverseSaleEntries`).
- **Expected behavior:** Cancellation should reverse exactly the original financial footprint and roll back entirely on any failure.
- **Actual behavior:** The service locks the invoice, prevents repeated/returned cancellation, restores stock, reverses available customer credit, queries actual original cash/bank postings (including their bank account), posts reversing treasury transactions, reverses the journal's remaining net footprint, marks the invoice cancelled, records history/activity, and voids warranties in one transaction.
- **Evidence:** `invoiceService.js:891`–`1058`; original-account lookup at lines 985–1014; net journal reversal at `journalService.js:490`–`509`. Regression cases exist at `tests/integration/invoiceIntegrity.test.js:117`, `:138`, and `:150` but were skipped in this run.
- **Safe reproduction:** Run those tests only against their disposable database harness.
- **Root cause:** Not applicable.
- **Recommended fix:** Preserve the reversal linkage and transaction boundary; require cancellation reason as in SI-07.

### SI-14 — Interrupted checkout has an explicit recovery path

- **Severity:** Medium
- **Status:** PASS
- **Verification:** Verified by code and passing frontend tests; server integration tests were skipped.
- **Feature:** API failures, timeouts, retries, and uncertain outcomes.
- **Location:** `web/lib/pos/checkout.ts:158` (`submitSale`), `web/lib/pos/checkout.ts:220` (`isConnectionError`), `web/lib/pos/checkout.ts:231` (`resolveSaleOutcome`), `server/controllers/invoicesController.js:725` (`checkoutStatus`).
- **Expected behavior:** After a lost response, the POS must not declare failure or start a new sale until it can determine whether confirmation committed.
- **Actual behavior:** The frontend persists the checkout ID/payment keys, queries status before a retry, checks the server after timeout/network failure, returns the confirmed sale if found, preserves the cart when not completed, and warns the user not to start again if the result remains unknown.
- **Evidence:** `checkout.ts:171`–`215` and `:218`–`258`; status endpoint at `invoicesController.js:722`–`742`. `web/lib/pos/checkoutRecovery.test.ts`, `checkoutResume.test.ts`, and cashier terminal recovery tests all passed.
- **Safe reproduction:** Run the frontend recovery tests; they use mocks and no database.
- **Root cause:** Not applicable.
- **Recommended fix:** Preserve the recovery UX. Consider making confirmation itself return/replay an idempotent outcome for a stable operation key.

## Test coverage

### Executed safely

| Test command/scope | Result |
|---|---|
| Server invoice totals, line discounts, stock movement, and locking/rollback contract tests | **38 passed** |
| Next.js POS totals, checkout preparation, recovery/resume, payment dialog, and cashier terminal tests | **64 passed** |
| Read-only pure-function probe for excessive invoice discount | Reproduced inconsistent stored discount: subtotal 100, discount 1000, total 0, paid. |
| Repository change check before report creation | Only the pre-existing untracked `AUTHENTICATION_AUTHORIZATION_AUDIT.md` was present. |

### Not executed

- **51 PostgreSQL integration tests were skipped** because `INVOICE_TEST_PG_PORT` was not configured. These suites create and drop disposable databases and cover checkout concurrency, payment idempotency, stock/treasury rollback, credit races, draft optimistic concurrency, and DB constraints. No fallback connection was attempted because it could have targeted development or production data.
- The opt-in live PostgreSQL concurrency test (`tests/contracts/concurrency.live.test.js`) was not enabled.
- No browser was connected to a running POS, no external card/bank/check provider was contacted, and no production logs or data were inspected.
- Installed production migration/constraint state and historical data reconciliation remain **NOT TESTED**; migration files describe intended schema, not proof that a deployment applied and validated them.

### Coverage gaps

- No existing concurrent approve-vs-reject test covers SI-01.
- No row-level authorization test uses two Cashier identities against the same draft.
- No invoice test covers independent card, bank-transfer, or check lifecycle because those tender types are not modeled.
- No test rejects invoice discount above the post-line-discount merchandise value.
- No live test forces opposite lock order across two multi-variant invoice/edit transactions.
- No test verifies that confirmed cancellation requires a reason or that cash sale confirmation refuses a closed drawer.

## Prioritized remediation plan

1. **Make edit decisions linearizable (SI-01).** Transactionally lock and compare-and-set request status; add approve/reject race tests before further invoice-edit deployment.
2. **Enforce draft ownership/claiming (SI-02).** Apply row-level authorization to list, detail, item, payment, confirmation, checkout-status, and edit-request paths; define audited manager takeover.
3. **Correct tender modeling (SI-03).** Separate card, transfer, and check; require destination/reference metadata; implement check clearing and exact reversal linkage.
4. **Close financial invariant gaps (SI-04, SI-05).** Reject excessive discounts, add DB state/method/nonnegative/equation constraints, reconcile historical rows, and validate existing `NOT VALID` constraints.
5. **Strengthen point-of-sale controls (SI-06, SI-07).** Require a deliberately opened cash session and a meaningful cancellation reason, with an elevated audited exception if business continuity requires one.
6. **Harden concurrency recovery (SI-08).** Acquire variant locks in canonical order and add bounded full-transaction retry for safe PostgreSQL deadlock/serialization failures.
7. **Make isolated PostgreSQL suites mandatory in CI.** Run the 51 skipped invoice/idempotency/constraint tests plus new cases above on every change to sales, treasury, journal, stock, customer credit, or migrations.

## Overall conclusion

The present confirmation and cancellation services provide a credible atomic financial core, and the duplicate-sale recovery design is materially stronger than a client-only retry scheme. Release risk remains **High** until the edit-decision race and cross-cashier draft authorization are fixed. Financial reconciliation quality remains **Medium risk** until tender channels, bank destination selection, discount bounds, and database invariants are made explicit and enforceable.
