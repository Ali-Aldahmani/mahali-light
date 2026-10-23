# Customer Profile — Financial Accuracy, Data Integrity & Audit Trail Audit

**Audit date:** 2026-10-23  
**Repository:** `D:\Projects\mahali-light`  
**Scope:** Read-only source, migration, API-contract, UI, and existing-test inspection  
**Runtime/database scope:** No application service, production database, container, or LAN terminal was touched. `INVOICE_TEST_PG_PORT` was absent, so the PostgreSQL integration suite—which creates and drops a database—was not executed.  
**Repository changes:** This report is the only file created by this audit.

## 1. Executive Summary

The Customer Profile module is **not production-ready for financial or audit-trail reliance**. Its customer debt mutation path is comparatively strong: balance collections validate positive amounts, lock the customer row, reject over-collection, and commit the payment, balance, treasury entry, and journal entry in one PostgreSQL transaction. Authentication and permission checks are enforced by the backend, actor IDs are taken from the authenticated session, customer creation stores `created_by`, and customer/user deactivation retains financial foreign-key history.

The profile nevertheless presents materially incomplete or inconsistent financial information:

- **Total Spent is gross eligible invoicing**, not net customer spend. It includes `refunded` invoices and does not subtract partial returns or refunds.
- **Last Purchase uses invoice creation date**, not the authoritative confirmation/purchase timestamp.
- **Last Payment on the profile ignores invoice checkout payments** and sees only later accounts-receivable collections. The hover summary uses a different, broader definition.
- **Invoices Count and Average Order Value inherit the same refunded/return problem**, and the count cannot be reconciled visually with the unfiltered Invoices tab.
- **The Timeline query joins `invoices.employee_id`, a column that does not exist on `invoices`**, so the endpoint is expected to fail when invoice support is present. The frontend suppresses the error and can display “No activity yet.”
- **Required customer audits are best-effort and non-transactional.** `logActivity()` catches insertion failure and lets the already-committed customer mutation succeed. Full-field edits do not record field names or old/new values; only credit-limit changes get a delta.
- **Concurrent edits are last-writer-wins.** There is no row lock, version, ETag, or compare-and-swap check. A stale full form can overwrite a newer change, and the credit-limit audit can record an incorrect predecessor.
- **Cross-terminal updates are incomplete.** Balance changes are pushed only to Manager/Admin Socket.IO rooms; customer edits, creation, status changes, invoice changes, and returns do not refresh the open profile. The page receives invoice/return buses nowhere.

### Highest-risk findings

| ID | Finding | Severity | Confidence |
|---|---|---:|---|
| F01 | Customer mutation and required audit are non-atomic; audit failure is swallowed | **CRITICAL** | **CONFIRMED** |
| F02 | Timeline SQL references nonexistent `invoices.employee_id` and UI suppresses the error | **CRITICAL** | **CONFIRMED** |
| F03 | Full customer edits lack exact old/new field history | **HIGH** | **CONFIRMED** |
| F04 | Total Spent/AOV are not net of returns or refunds and include refunded invoices | **HIGH** | **CONFIRMED** |
| F05 | Last Payment excludes normal invoice payments; Payments tab has the same omission | **HIGH** | **CONFIRMED** |
| F06 | Concurrent edits can overwrite newer values and produce inaccurate audit history | **HIGH** | **CONFIRMED** |
| F07 | Open profiles remain stale across terminals for most customer and financial events | **HIGH** | **CONFIRMED** |
| F14 | An inactive customer is not rejected by the backend credit-limit helper | **HIGH** | **CODE-SUPPORTED RISK** |

## 2. Discovered Architecture

### Technology and deployment

- **Frontend:** Next.js 15, React 18, TypeScript, Axios, Zustand, and Socket.IO client (`web/package.json:20-24`).
- **Backend:** Node.js/Express with Zod validation and Socket.IO (`package.json:38-50`).
- **Database:** PostgreSQL 16 through raw `pg` queries; no ORM is used in the audited customer path (`docker-compose.yml:8-26`, `package.json:46`, `server/db/postgres.js:1-48`).
- **Deployment:** separate PostgreSQL, Express API, and Next.js containers on one Docker bridge; browser terminals reach the published Next.js/API ports (`docker-compose.yml:32-112`).
- **Timezone:** backend process and PostgreSQL sessions use `STORE_TIMEZONE`, defaulting to `Asia/Dubai`; the frontend formatters use the configured business timezone (`server/utils/dates.js:18-69`, `server/db/postgres.js:17-31`, `web/lib/utils/format.ts:28-53`).

### Database model and data flow

`customers` stores the profile, current accounts-receivable snapshot (`credit_balance`), credit limit, active flag, creator, and database-generated `TIMESTAMPTZ` values (`server/db/migrations/005_customers.sql:5-20`). `customer_payments` stores later balance collections (`server/db/migrations/005_customers.sql:22-33`). Sales and checkout payments are separate in `invoices` and `invoice_payments` (`server/db/migrations/006_invoices.sql:3-31`, `54-64`). Returns/refunds use `return_requests`, `return_orders`, `return_order_items`, and `refund_payments` (`server/db/migrations/009_returns.sql:3-100`). Warranties preserve customer, invoice, invoice-item, product, and creator associations (`server/db/migrations/008_warranties.sql:3-26`).

The profile flow is:

1. `web/app/(dashboard)/customers/[id]/page.tsx:156-178` calls `GET /customers/:id` and listens only for customer-balance events.
2. `server/routes/customers.js:7-53` authenticates every route and applies per-operation permissions.
3. `server/controllers/customersController.js:100-133` aggregates summary cards with PostgreSQL lateral joins.
4. `server/controllers/customersController.js:48-82` maps database results into the API contract.
5. `web/app/(dashboard)/customers/[id]/page.tsx:255-313` renders cards and lazy tab components.

### Authentication, permissions, and server authority

`requireAuth()` verifies the JWT, checks the hashed token against a live session, reloads the current user and permissions, and rejects inactive users (`server/middleware/auth.js:73-125`). Customer routes require specific permissions for view, create, edit, delete, balance visibility, and collection (`server/routes/customers.js:17-52`). `requirePermission()` returns 403 when an authenticated user lacks a required permission (`server/middleware/permissions.js:5-21`). Mutation actors are read from `req.user.id`, not request bodies.

**Finding F09 — Backend customer authorization is structurally enforced**  
**Severity:** LOW  
**Confidence:** CONFIRMED  
**Evidence:** `server/routes/customers.js:7-22`; `server/middleware/permissions.js:5-21`; `server/middleware/auth.js:98-125`.  
**Impact:** A client cannot obtain edit access merely by exposing a UI control or supplying an actor ID.  
**Recommended fix:** Retain these controls and add integration tests for 401/403 behavior per route.  
**Verification:** Use an isolated database and tokens for a user with and without each permission; confirm 401/403 and unchanged rows.

## 3. Customer Summary Cards Accuracy

| Card | Database source | Backend calculation | UI rendering | Audit result |
|---|---|---|---|---|
| Total Spent | `invoices.total` | `SUM(total)` where status is neither `cancelled` nor `draft` | Currency | **Incorrect as net spend** |
| Credit Balance | `customers.credit_balance` | Snapshot returned only with `customer.view_balance` | Currency or `—` | **Meaning is outstanding debt; runtime balance not verified** |
| Last Purchase | `invoices.created_at` | `MAX(created_at)::date` on eligible invoices | Date only | **Wrong event timestamp** |
| Last Payment | `customer_payments.payment_date` | `MAX(payment_date)` | Date only | **Incomplete source set** |
| Invoices | `invoices` | `COUNT(*)` on the same eligible set | Integer | **Internally aligned with Total Spent, but not net/refund-aware** |
| Avg Order Value | `invoices.total` | `SUM(total)/COUNT(*)` on the eligible set | Currency | **Gross eligible invoice average, not net AOV** |

The calculations are performed by PostgreSQL and the backend, not trusted from browser values (`server/controllers/customersController.js:100-133`, `48-82`). The UI displays the returned values directly (`web/app/(dashboard)/customers/[id]/page.tsx:255-296`). This is authoritative in origin but not consistently defined.

**Finding F10 — Financial cards use backend data but incompatible business definitions**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** profile aggregate `server/controllers/customersController.js:100-123`; Returns-tab aggregate `server/controllers/customersController.js:709-748`; reporting aggregate `server/services/reportService.js:914-958`; analytics aggregate `server/services/analyticsService.js:413-460`.  
**Impact:** The same customer can have different “Total Spent,” count, AOV, and last-purchase values depending on screen or report.  
**Recommended fix:** Define canonical metrics (gross confirmed invoices, net sales after returns, cash collected, and current AR) and implement shared SQL/service definitions.  
**Verification:** Populate an isolated fixture with draft, confirmed, cancelled, refunded, partially returned, cash, and credit invoices and compare every module to one expected ledger.

## 4. Total Spent Findings

The actual implementation defines Total Spent as:

```text
SUM(invoices.total)
WHERE customer_id = customer.id
  AND status NOT IN ('cancelled', 'draft')
```

This is **gross invoiced value for non-draft/non-cancelled invoices**. It is not settled purchases and not net sales. `total` already reflects invoice discounts and tax, so tax is included and discounts are reflected. Cash, bank, and credit sales are included regardless of payment state. Payments are not double-counted because the query reads only `invoices`, and the lateral subquery does not join line or payment tables (`server/controllers/customersController.js:100-111`).

**Finding F04 — Total Spent includes refunded invoices and ignores partial returns/refunds**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** `refunded` is a declared invoice status (`server/db/migrations/006_invoices.sql:16-17`), while the card excludes only `cancelled` and `draft` (`server/controllers/customersController.js:100-111`). No return table participates. Executed refunds are stored in `return_orders`/`refund_payments` (`server/db/migrations/009_returns.sql:52-100`) and posted in `server/services/returnService.js:1023-1078`.  
**Impact:** A fully refunded invoice remains fully included; a partial return never reduces the card. Customer lifetime value and AOV are overstated.  
**Recommended fix:** Adopt a documented metric. For net customer spend, aggregate confirmed sales minus executed customer return value/revenue using immutable return-order rows; define whether tax is included.  
**Verification:** In an isolated database, create a confirmed AED 100 invoice, execute a AED 25 partial refund, then a full refund scenario; assert the canonical net metric and every consumer.

**Finding F11 — Total Spent definitions diverge inside the customer profile and reports**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** main card excludes draft/cancelled but includes refunded (`server/controllers/customersController.js:100-111`); Returns tab excludes only cancelled and therefore includes drafts (`server/controllers/customersController.js:709-721`); customer report and analytics include only `confirmed` and use `confirmed_at` (`server/services/reportService.js:917-928`, `server/services/analyticsService.js:416-439`); dashboard KPIs separately subtract customer returns (`server/services/analyticsService.js:900-950`).  
**Impact:** Staff can see conflicting totals for the same customer and period, undermining financial reconciliation.  
**Recommended fix:** Centralize eligibility and return treatment in one tested backend query/service.  
**Verification:** Run the same fixture through profile, Returns tab, Customer Summary report, Top Customers, and accounting dashboard; require exact agreement for like-for-like metrics.

**Precision:** PostgreSQL performs `SUM` and division using `DECIMAL/NUMERIC`, then Node converts results to JavaScript `Number` (`server/controllers/customersController.js:64-67`). Display rounds to two decimals (`web/lib/utils/format.ts:102-109`). This is adequate for ordinary `DECIMAL(12,2)` POS values, but the conversion removes exact decimal semantics at the API boundary. No source evidence of an actual cent error was found.

## 5. Credit Balance Findings

The field named **Credit Balance** is an outstanding customer debt / accounts-receivable snapshot. It is not available credit, prepayment, store credit, or refund credit. Available headroom is conceptually `credit_limit - credit_balance`; a zero limit means unlimited (`server/services/customerService.js:277-306`). The UI separately displays the credit limit (`web/app/(dashboard)/customers/[id]/page.tsx:369-390`).

Credit sales add only the invoice’s `credit` payment portion to `customers.credit_balance` inside invoice confirmation (`server/services/invoiceService.js:597-617`). Later customer collections lock the customer row, reject inactive customers, reject amounts exceeding debt, insert `customer_payments`, reduce the balance, and post treasury and AR journal entries in one transaction (`server/services/customerService.js:20-164`). Credit refunds reduce the debt under a customer row lock (`server/services/returnService.js:1048-1064`).

**Finding F12 — Balance mutations are serialized and atomic, but the displayed balance is a maintained snapshot with no reconciliation invariant**  
**Severity:** MEDIUM  
**Confidence:** CODE-SUPPORTED RISK  
**Evidence:** row lock/transaction `server/services/customerService.js:50-108`; invoice increment `server/services/invoiceService.js:608-616`; refund decrement `server/services/returnService.js:1048-1064`; schema has no nonnegative/check/reconciliation constraint `server/db/migrations/005_customers.sql:5-20`. Receivables reporting reuses the same snapshot rather than independently summing open invoices (`server/services/reportService.js:961-1013`).  
**Impact:** Normal service paths should prevent concurrent over-collection, but historic defects, manual database changes, missed mutation paths, or migration errors can leave the profile and AR report consistently wrong together.  
**Recommended fix:** Add a read-only reconciliation query/report comparing `credit_balance` to the canonical credit-sale, collection, credit-refund, and reversal ledger; add database checks appropriate to the defined model.  
**Verification:** In an isolated fixture, exercise split credit sale, partial collections, simultaneous collections, cancellation, credit refund, and reversal, then reconcile balance, invoice balances, treasury, and GL entries to cents.

**Finding F13 — “Credit Balance” terminology can be mistaken for customer-owned credit**  
**Severity:** MEDIUM  
**Confidence:** CONFIRMED  
**Evidence:** the same value gates “Collect payment” and is decreased on collection (`web/components/customers/CollectPaymentSlideOver.tsx:41-84`); schema separately stores `credit_limit` (`server/db/migrations/005_customers.sql:13-14`). Credit refunds are permitted only up to existing debt and reduce it (`server/services/returnService.js:1048-1064`), so this is not a store-credit wallet.  
**Impact:** Staff may read a positive value as money available to the customer rather than money owed by the customer.  
**Recommended fix:** Label it “Outstanding balance” or “Accounts receivable,” and show available credit separately when a finite limit exists.  
**Verification:** Conduct acceptance testing with cashiers/managers and confirm the labels match accounting semantics for debt, limit, and refunds.

**Finding F14 — Inactive-customer credit enforcement is incomplete**  
**Severity:** HIGH  
**Confidence:** CODE-SUPPORTED RISK  
**Evidence:** collections reject `!customer.is_active` (`server/services/customerService.js:51-69`), but `assertWithinCreditLimit()` selects only balance, limit, and name and never checks `is_active` (`server/services/customerService.js:280-306`). Invoice confirmation calls that helper before increasing debt (`server/services/invoiceService.js:597-616`).  
**Impact:** A draft, cached customer ID, direct API workflow, or concurrent deactivation may allow new debt for an inactive customer even though the UI search normally filters active customers.  
**Recommended fix:** Lock and validate active status in the authoritative invoice confirmation transaction.  
**Verification:** In an isolated database, create a draft for an active customer, deactivate the customer, then attempt credit confirmation; require a 409 and no invoice, AR, treasury, or journal mutation.

## 6. Last Purchase and Last Payment

**Finding F15 — Last Purchase is based on record creation, not completed purchase time**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** the card uses `MAX(created_at)::date` after status filtering (`server/controllers/customersController.js:100-111`), although invoices store `confirmed_at TIMESTAMPTZ` (`server/db/migrations/006_invoices.sql:9-10`). Reports use `MAX(i.confirmed_at)` for last purchase (`server/services/reportService.js:917-925`, `server/services/analyticsService.js:416-421`). The API discards time by casting to `date`, and UI renders a date (`web/app/(dashboard)/customers/[id]/page.tsx:269-276`).  
**Impact:** A draft created earlier and confirmed later reports the draft creation day as the purchase day; refunded invoices still qualify; time-of-purchase cannot be shown.  
**Recommended fix:** Define purchase as successful confirmation and use `MAX(confirmed_at)` over the canonical eligible status set, preserving `TIMESTAMPTZ` in the API.  
**Verification:** Create drafts on day 1, confirm on day 2, cancel one, refund one, and ensure the expected completed purchase instant is selected in Asia/Dubai.

**Finding F05 — Last Payment card and Payments tab omit invoice checkout payments**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** card query reads only `MAX(customer_payments.payment_date)` (`server/controllers/customersController.js:120-123`). Payment list reads only `customer_payments` (`server/controllers/customerPaymentsController.js:35-52`). Normal sale payments live in `invoice_payments` (`server/db/migrations/006_invoices.sql:54-64`). By contrast, the hover summary explicitly unions non-credit invoice payments and customer balance collections (`server/controllers/customersController.js:274-302`).  
**Impact:** A customer can pay cash/bank at checkout yet show “—” for Last Payment and “No payments yet,” while the hover card shows a payment.  
**Recommended fix:** Define and expose a unified successful-payment view with source, amount, method, event timestamp, actor, status/reversal, and stable ID.  
**Verification:** Test cash checkout, split checkout, credit sale, later partial collection, bank collection, and reversal; assert the same latest successful payment across card, hover, tab, timeline, and report.

**Finding F16 — Payment date/time and reversal history are not durable in the customer-facing history**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** the Payments tab displays only `payment_date` as a date (`web/app/(dashboard)/customers/[id]/page.tsx:619-644`); `created_at` retains time in the table (`server/db/migrations/005_customers.sql:29-32`). Voiding physically deletes the original payment (`server/services/customerService.js:206-208`) and restores the balance, while the separate activity event is best-effort (`server/controllers/customerPaymentsController.js:151-160`). The timeline excludes `customer.payment_voided` (`server/controllers/customersController.js:809-821`).  
**Impact:** The visible payment history cannot prove the original transaction time or retain a voided payment/reversal pair. A failed audit write can erase customer-facing evidence of the original collection entirely.  
**Recommended fix:** Preserve immutable payment rows with `status`, `voided_at`, `voided_by`, and reversal linkage; display both business date and server event time.  
**Verification:** Record and void a payment in an isolated environment; verify both immutable entries, actors, timestamps, treasury reversal, GL reversal, and UI visibility.

## 7. Invoice Count and Average Order Value

The invoice count is `COUNT(*)` over the same non-draft/non-cancelled invoice set, so joins cannot duplicate it and pagination does not influence the card (`server/controllers/customersController.js:100-111`). AOV is exactly the same set’s `SUM(total)/COUNT(*)`, with a zero guard (`server/controllers/customersController.js:103-109`). Therefore numerator and denominator are internally aligned.

**Finding F17 — Count and AOV include refunded sales and do not reflect partial returns**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** same aggregate and status set as F04 (`server/controllers/customersController.js:100-111`); return orders are absent.  
**Impact:** Both order count and average can misstate economic customer activity after returns/refunds.  
**Recommended fix:** Document whether refunded orders remain orders; define AOV numerator and denominator together and account for partial returns consistently.  
**Verification:** Calculate expected metrics for confirmed, zero-value, cancelled, fully refunded, and partially returned invoices and assert exact backend/UI results.

**Finding F18 — Card count cannot be reconciled with the Invoices tab**  
**Severity:** MEDIUM  
**Confidence:** CONFIRMED  
**Evidence:** the card excludes draft/cancelled (`server/controllers/customersController.js:100-111`), while the tab fetches every customer invoice without a status filter (`server/controllers/customersController.js:619-646`). The table displays only `paymentStatus` in its Status column, not invoice `status` (`web/app/(dashboard)/customers/[id]/page.tsx:458-519`).  
**Impact:** The tab can contain more rows than the card and does not reveal which rows were excluded as draft/cancelled/refunded.  
**Recommended fix:** Display both lifecycle status and payment status, and label the card “Eligible invoices” or align tab filtering with the metric.  
**Verification:** Use one invoice per lifecycle/payment status and reconcile the visible row set to the card count.

## 8. Customer Since and Status

**Customer Since:** `customers.created_at` is a database-generated `TIMESTAMPTZ` (`server/db/migrations/005_customers.sql:17-19`). The update statement does not change it (`server/controllers/customersController.js:412-437`). The API returns it and the UI renders it (`server/controllers/customersController.js:61-62`, `web/app/(dashboard)/customers/[id]/page.tsx:387-390`). Restoration through editing `isActive` also leaves it unchanged. The card shows only the calendar date, although time remains stored.

**Status:** only `is_active BOOLEAN` exists; the module has no blocked/suspended state (`server/db/migrations/005_customers.sql:15-19`). The UI truthfully maps it to Active/Inactive (`web/app/(dashboard)/customers/[id]/page.tsx:381-385`). Delete is a soft deactivation (`server/controllers/customersController.js:464-498`), preserving invoices, payments, returns, and warranties.

**Finding F19 — Status transitions and restoration lack reconstructable audit events**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** the generic edit accepts `isActive` and logs only `customer.updated` without values (`server/controllers/customersController.js:384-454`). Delete logs `customer.deleted` with a name note but no old/new state (`server/controllers/customersController.js:464-496`). Timeline excludes `customer.deleted` and has no restoration event (`server/controllers/customersController.js:809-821`).  
**Impact:** Auditors cannot reliably establish when or why a customer changed status or distinguish restore from an unrelated edit.  
**Recommended fix:** Implement immutable `customer.status_changed` events containing old/new state, actor, reason, timestamp, and request/source metadata in the same transaction.  
**Verification:** Exercise active→inactive→active transitions and assert one ordered durable event per committed transition with unchanged fields excluded.

## 9. Customer Creation Audit

The create endpoint validates server-side, writes `created_by = req.user.id`, and relies on database defaults for ID and timestamps (`server/controllers/customersController.js:335-365`; `server/db/migrations/005_customers.sql:5-19`). This correctly binds creator ID to a real user FK. The actor row survives normal user deactivation because users are soft-deactivated (`server/controllers/usersController.js:300-323`).

**Finding F20 — Creation audit is incomplete and may be missing despite a successful customer create**  
**Severity:** CRITICAL  
**Confidence:** CONFIRMED  
**Evidence:** insert commits through a standalone pool query, then `logActivity()` runs separately (`server/controllers/customersController.js:348-374`). `logActivity()` catches all insert errors and resolves (`server/utils/activityLog.js:12-29`). The audit stores only action, actor, customer ID, timestamp default, and customer name note; it omits the initial snapshot, source, branch/terminal, and request/event identifier (`server/controllers/customersController.js:368-374`; `server/db/migrations/001_init.sql:84-94`).  
**Impact:** A customer can exist without the required creation audit. Even when present, the initial state and origin cannot be reconstructed.  
**Recommended fix:** Insert customer and required immutable audit event with the same transaction/client; treat audit failure as transaction failure; record a controlled initial snapshot plus source/terminal metadata.  
**Verification:** Inject an audit insertion failure in an isolated database and assert both customer and audit roll back; then verify a normal creation’s exact initial snapshot and actor.

**Finding F21 — Creator is stored but not exposed as a first-class profile field**  
**Severity:** MEDIUM  
**Confidence:** CONFIRMED  
**Evidence:** `created_by` exists (`server/db/migrations/005_customers.sql:17`) and is inserted (`server/controllers/customersController.js:348-365`), but `shapeCustomer()` omits it (`server/controllers/customersController.js:48-82`). The UI has no creator field (`web/app/(dashboard)/customers/[id]/page.tsx:205-400`). Timeline would rely on the separate audit event.  
**Impact:** Staff cannot reliably identify the creator when the audit event is absent; the authoritative creator FK is stranded in the database.  
**Recommended fix:** Return a permission-controlled creator ID/name derived from `customers.created_by`, retaining the immutable ID even if display names change.  
**Verification:** Deactivate and rename a creator in an isolated fixture; verify the profile retains stable ID and clearly distinguishes current display identity from event-time identity.

## 10. Customer Modification Audit

Editable fields are name, phone, email, address, company, TRN, credit limit, notes, and active state (`server/controllers/customersController.js:9-41`; `web/components/customers/CustomerFormSlideOver.tsx:131-160`). The backend selects the existing row, performs a full-row update, then logs `customer.updated`. Only a credit-limit change produces a second event with an old/new delta (`server/controllers/customersController.js:384-454`).

**Finding F03 — General edits do not record fields or exact old/new values**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** `customer.updated` contains actor but no `oldValue`, `newValue`, notes, or changed-field list (`server/controllers/customersController.js:439-444`). Credit limit alone has old/new values (`server/controllers/customersController.js:445-453`).  
**Impact:** Name, phone, email, address, company, TRN, notes, and status history cannot be reconstructed. Fraud, data-quality mistakes, and unauthorized-looking changes cannot be investigated from the audit log.  
**Recommended fix:** Under a row lock, diff authoritative stored values against validated replacements; log only changed fields with exact old/new values in the same transaction. Apply a deliberate masking policy to personal data while keeping sufficient forensic evidence.  
**Verification:** Change each editable field separately and in combinations; assert exact deltas, no secrets, and no event for a no-op save.

**Finding F22 — No-op saves are falsely recorded as updates**  
**Severity:** MEDIUM  
**Confidence:** CONFIRMED  
**Evidence:** the update statement and `customer.updated` call run unconditionally after validation (`server/controllers/customersController.js:412-444`); there is no diff or affected-value check.  
**Impact:** Audit volume contains events that do not represent real changes, reducing evidentiary value.  
**Recommended fix:** Compute a normalized field diff and return success without a mutation/audit event when it is empty.  
**Verification:** Save an unchanged form and assert unchanged `updated_at` and no new audit row.

## 11. Old/New Value Tracking

| Field | Old value | New value | Actor | Timestamp | Result |
|---|---:|---:|---:|---:|---|
| Credit limit | Yes | Yes | Yes | DB audit timestamp | Partial support |
| Name | No | No | Yes | DB audit timestamp if audit succeeds | Inadequate |
| Phone | No | No | Yes | Same | Inadequate |
| Email | No | No | Yes | Same | Inadequate |
| Address | No | No | Yes | Same | Inadequate |
| Company | No | No | Yes | Same | Inadequate |
| TRN | No | No | Yes | Same | Inadequate |
| Notes | No | No | Yes | Same | Inadequate |
| Active status | No | No | Yes | Same | Inadequate |

The actor and timestamp are server-derived when an event exists (`req.user.id`; `activity_log.timestamp DEFAULT NOW()`), but historical identity is not snapshotted. Timeline joins `activity_log.performed_by` to the **current** `users.username` (`server/controllers/customersController.js:809-820`). Normal user deactivation retains that row, but a later username change changes what history displays; a hard database deletion would null the FK (`server/db/migrations/001_init.sql:84-94`).

**Finding F23 — Historical actor display is mutable identity, not event-time identity**  
**Severity:** MEDIUM  
**Confidence:** CONFIRMED  
**Evidence:** activity log stores only `performed_by` (`server/db/migrations/001_init.sql:84-94`); timeline resolves current username at read time (`server/controllers/customersController.js:809-820`). Users are normally soft-deactivated (`server/controllers/usersController.js:310-323`).  
**Impact:** Stable user ID survives soft deletion, but the displayed name may no longer be the name used at the time of the event.  
**Recommended fix:** Keep the stable FK and also store a controlled event-time actor display snapshot, or query a versioned identity history.  
**Verification:** Change/deactivate an actor after an event and verify both immutable actor ID and event-time identity remain available.

## 12. Audit Log Reliability

**Finding F01 — Audit writes are best-effort, non-transactional, and silently lossy**  
**Severity:** CRITICAL  
**Confidence:** CONFIRMED  
**Evidence:** customer create/update/delete and payment mutation complete before separate `logActivity()` calls (`server/controllers/customersController.js:348-374`, `412-454`, `485-496`; `server/controllers/customerPaymentsController.js:63-80`, `151-160`). `logActivity()` catches and only warns on every failure (`server/utils/activityLog.js:12-29`).  
**Impact:** A successful financial or customer mutation can permanently lack required evidence. The caller still receives success, and monitoring cannot infer the missing event from the response.  
**Recommended fix:** Provide a transaction-bound audit writer that uses the caller’s PostgreSQL client; make required event failure roll back the business mutation. Add alerting and a unique event/request key.  
**Verification:** Fault-inject audit table permission, constraint, and connection failures; verify mutation rollback and visible operational alert.

**Finding F24 — Activity rows have no database append-only or tamper-evidence control**  
**Severity:** MEDIUM  
**Confidence:** CODE-SUPPORTED RISK  
**Evidence:** `activity_log` is a normal table with no immutability trigger, chained hash, signature, or restricted write policy declared in `server/db/migrations/001_init.sql:84-100`. No ordinary customer API for editing audit rows was found.  
**Impact:** Application users cannot alter events through the audited routes, but a privileged database/application credential could update or delete history without intrinsic detection.  
**Recommended fix:** Restrict DB privileges, expose insert-only procedures, add append-only enforcement and protected backups/tamper evidence appropriate to the threat model.  
**Verification:** Under a test role matching production API privileges, assert UPDATE/DELETE on audit rows are denied and integrity verification detects privileged tampering.

## 13. Customer Financial Tabs

### Invoices

The backend filters by stable `customer_id` and returns all lifecycle states ordered by `created_at` (`server/controllers/customersController.js:619-646`). Amount, paid, balance, and payment status come directly from invoice rows. There is no server pagination. The UI labels the payment status as “Status” and omits invoice lifecycle status (`web/app/(dashboard)/customers/[id]/page.tsx:458-541`).

### Payments

The backend and tab contain only later `customer_payments`, not checkout `invoice_payments` (`server/controllers/customerPaymentsController.js:35-52`; `web/app/(dashboard)/customers/[id]/page.tsx:545-688`). Actor is displayed, but event time is reduced to the business date. Voided rows are deleted.

### Returns

The tab correctly scopes requests by `customer_id` and includes invoice/order references (`server/controllers/customersController.js:682-750`). Its secondary “Total spent” uses another formula that includes drafts; “Returned value” counts request `total_value` for `approved` requests, not necessarily cash refund amount (`server/controllers/customersController.js:709-748`). The UI displays request date only and does not show refund method, refund amount, or actor (`web/app/(dashboard)/customers/[id]/page.tsx:691-790`).

### Warranties

Warranty rows are correctly scoped by `w.customer_id`, with invoice, product, variant, supplier, and creator joins (`server/controllers/customersController.js:756-785`). The schema preserves those stable associations (`server/db/migrations/008_warranties.sql:3-26`). No runtime referential-data test was executed.

### Timeline

**Finding F02 — Timeline endpoint uses an invalid invoice actor column and hides the resulting error in the UI**  
**Severity:** CRITICAL  
**Confidence:** CONFIRMED  
**Evidence:** Timeline joins `u.id = i.employee_id` (`server/controllers/customersController.js:823-834`), but the invoice header has `created_by`, `confirmed_by`, `updated_by`, and `cancelled_by`, not `employee_id` (`server/db/migrations/006_invoices.sql:3-31`). The UI catches and discards the request error, then renders the empty state (`web/app/(dashboard)/customers/[id]/page.tsx:860-896`). A corrected read-only static contract check returned `FAIL`.  
**Impact:** Customer history is expected to fail whenever the invoices table exists; staff may see “No activity yet” instead of an error, concealing missing audit evidence.  
**Recommended fix:** Use the actor appropriate to the event (`created_by` or `confirmed_by`), validate the endpoint with PostgreSQL integration tests, and show an explicit load error.  
**Verification:** Execute the endpoint against an isolated migrated database with and without invoices and assert 200, actor identity, event ordering, and visible frontend error handling.

**Finding F25 — Timeline omits and misclassifies required events**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** it includes retained customer payments, three profile activity actions, and all invoices labeled `invoice_created` (`server/controllers/customersController.js:791-837`). It excludes returns, warranties, invoice confirmation/cancellation semantics, payment voids, customer deletion/restoration, and payment checkout events. It caps at 200 with no API pagination (`server/controllers/customersController.js:837-851`), while the frontend’s Load more only reveals already-fetched rows (`web/app/(dashboard)/customers/[id]/page.tsx:899-960`).  
**Impact:** Even after fixing the SQL error, the Timeline cannot represent the authoritative customer lifecycle and can label cancelled/refunded invoices merely as created events.  
**Recommended fix:** Build the timeline from immutable domain events with explicit event types and cursor pagination; include stable references, actors, timestamps, financial amounts, and reversal state.  
**Verification:** Compare a scripted lifecycle’s source tables and event ledger against ordered, paginated timeline output.

## 14. Concurrency and Edge Cases

**Finding F06 — Concurrent full-form edits are last-writer-wins with inaccurate predecessor data**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** update reads the row without `FOR UPDATE`, version, or transaction, then overwrites all editable columns (`server/controllers/customersController.js:384-437`). The frontend submits the complete form snapshot (`web/components/customers/CustomerFormSlideOver.tsx:131-160`). Credit-limit old value is taken from the earlier unlocked read (`server/controllers/customersController.js:409-453`).  
**Impact:** PC-A can change phone while PC-B’s stale form later restores the old phone while changing status. Both return success, and credit-limit history may show the wrong old value.  
**Recommended fix:** Add optimistic concurrency (`updated_at`/version in the request and conditional update) or a locked read/diff/update transaction; return 409 with current values on conflict.  
**Verification:** Send two isolated requests from the same version changing different fields; assert one conflict or a deliberate merge and exact ordered audit deltas.

**Finding F26 — Deactivation races with financial activity**  
**Severity:** HIGH  
**Confidence:** CODE-SUPPORTED RISK  
**Evidence:** delete reads balance and later updates `is_active` without a transaction or row lock (`server/controllers/customersController.js:464-488`). Credit invoice confirmation locks the customer through `assertWithinCreditLimit()` but does not validate active status (`server/services/customerService.js:280-306`; `server/services/invoiceService.js:597-616`).  
**Impact:** Interleaving deactivation and invoice confirmation can produce an inactive customer with new debt or make the zero-balance decision stale.  
**Recommended fix:** Serialize deactivation with financial mutations on the customer row and validate both active state and balance in the same transaction.  
**Verification:** Use concurrent transactions and barriers to exercise both interleavings; require a deterministic valid outcome and matching audit.

**Finding F27 — Duplicate create/retry protection is incomplete**  
**Severity:** MEDIUM  
**Confidence:** CONFIRMED  
**Evidence:** there is no idempotency/request key in the create API (`server/controllers/customersController.js:335-378`). Phone equivalence is checked in application code before insert (`server/controllers/customersController.js:157-176`), while the database unique constraint covers only the stored string (`server/db/migrations/005_customers.sql:7-9`). Phone is optional at the backend (`server/controllers/customersController.js:9-17`).  
**Impact:** Network retry or double submission can create duplicate no-phone customers; concurrent differently formatted equivalent phone numbers can pass the pre-check and evade the raw-string unique constraint. Repeated edit retries also create duplicate generic audit events.  
**Recommended fix:** Add idempotency keys, persist a canonical phone key with a database unique constraint, and make updates no-op aware.  
**Verification:** Concurrently submit identical and formatting-equivalent requests plus retry-after-timeout scenarios; assert one customer and one audit event.

Other edge cases:

- A failed validation occurs before mutation/audit, but no runtime fault-injection test was run.
- A backend crash after customer update and before audit write leaves the mutation committed.
- Editing an inactive customer is allowed by the edit API; no explicit state rule prevents it.
- Payment concurrent over-collection is structurally prevented by `FOR UPDATE`; runtime isolation behavior was not tested.
- Payment void uses the original payment employee for treasury/journal reversal (`server/services/customerService.js:223-254`) while the activity event identifies the current requester (`server/controllers/customerPaymentsController.js:151-160`), creating actor inconsistency in financial subledgers.

## 15. Multi-Terminal Synchronization

**Finding F07 — Most customer-profile changes do not update an open profile on another terminal**  
**Severity:** HIGH  
**Confidence:** CONFIRMED  
**Evidence:** the profile loads on mount and subscribes only to `onCustomerBalanceUpdate` (`web/app/(dashboard)/customers/[id]/page.tsx:156-178`). Invoice and return buses exist (`web/store/socketStore.ts:67-74`, `243-251`, `339-340`), but this page does not subscribe. Create/update/delete controllers emit no customer-profile event. Invoice/collection balance events are emitted only to `role:Manager` and `role:Admin` (`server/services/invoiceService.js:756-772`; `server/controllers/customerPaymentsController.js:82-95`, `162-176`). Tabs load once per customer and do not subscribe (`web/app/(dashboard)/customers/[id]/page.tsx:442-456`, `577-580`, `695-701`, `799-805`, `865-879`).  
**Impact:** PC-B edits can remain stale on PC-A indefinitely until navigation/manual reload. New cash invoices do not refresh Total Spent, Last Purchase, Count, AOV, or Invoices tab. Returns do not refresh return statistics. Cashiers/custom roles do not receive balance pushes even if permitted to view balances.  
**Recommended fix:** Emit entity/version events after commit to permission-aware audiences; subscribe the profile and active tabs; on reconnect/focus, re-fetch authoritative state and reject older event versions.  
**Verification:** With two isolated browser sessions for each role, perform edit, status change, cash invoice, credit invoice, cancellation, payment, reversal, and return; measure eventual consistency and ensure reconnect reconciles missed events.

No polling was found on the profile. Local saves and collections explicitly reload the local profile (`web/app/(dashboard)/customers/[id]/page.tsx:301-327`), so the initiating terminal is better synchronized than peer terminals.

## 16. Cross-Module Financial Consistency

| Module | Invoice eligibility/date | Returns treatment | Payment source | Consistency result |
|---|---|---|---|---|
| Profile cards | not draft/cancelled; `created_at` | none | AR collections only for Last Payment | Divergent |
| Hover summary | not draft/cancelled | none | checkout non-credit + AR collections | Divergent from profile |
| Returns tab stats | not cancelled (draft included) | approved request `total_value` shown separately | N/A | Divergent |
| Customer Summary report | confirmed; `confirmed_at` | none | separate collection report | Divergent |
| Top Customers analytics | confirmed; `confirmed_at` | none | balance snapshot | Divergent |
| Dashboard KPIs | confirmed; `confirmed_at` | customer returns subtracted | ledger/report inputs | Different net model |
| Receivables report | current `customers.credit_balance` | whatever mutation path applied | same snapshot | Not independent reconciliation |

**Finding F28 — Cross-module reconciliation can appear successful while sharing the same balance snapshot**  
**Severity:** MEDIUM  
**Confidence:** CODE-SUPPORTED RISK  
**Evidence:** profile and AR report both use `customers.credit_balance` (`server/controllers/customersController.js:79-80`; `server/services/reportService.js:961-1013`), while invoice open balances are used only to choose an aging date, not to derive amount (`server/services/reportService.js:962-984`).  
**Impact:** Matching profile and receivables report does not prove subledger correctness; both can repeat the same corrupted snapshot.  
**Recommended fix:** Add an independent AR reconciliation from immutable invoice credit/payment/refund/reversal records and flag differences.  
**Verification:** Intentionally perturb a fixture snapshot and confirm reconciliation detects it while ordinary profile/report still match each other.

## 17. Detailed Test Matrix

The status below distinguishes read-only static execution from runtime testing. A PowerShell source-contract verifier was executed without creating files or contacting a database. It confirmed S01/S02/S03/S06/S12/S13/S15/S17 and failed S04/S05/S07/S08/S09/S10/S11/S14/S16/S18 after correcting S11 to scope only the invoice header. Runtime PostgreSQL/API/browser/LAN tests were not run because no verified isolated database endpoint was configured.

| ID | Scenario / expected result | Actual result | Status | Exact evidence | Severity | Recommended verification procedure |
|---|---|---|---|---|---:|---|
| T01 | Creation preserves server actor ID | Static S01 found FK and `req.user.id` insert | **PASS** (static) | `server/db/migrations/005_customers.sql:17`; `server/controllers/customersController.js:348-365` | HIGH | Isolated create; compare token subject, customer FK, audit FK |
| T02 | Creation preserves server date/time | Static S02 found DB `TIMESTAMPTZ DEFAULT NOW()` | **PASS** (static) | `server/db/migrations/005_customers.sql:18-19` | HIGH | Compare DB timestamp to server clock/timezone |
| T03 | Edit records actor identity | Static S03 found `performedBy: req.user.id` | **PASS** (static) | `server/controllers/customersController.js:439-444` | HIGH | Edit with two users; verify stable IDs |
| T04 | Edit records exact old/new values | Static S04 found no generic old/new | **FAIL** | `server/controllers/customersController.js:439-453` | HIGH | Change every field and inspect audit JSON |
| T05 | Unchanged fields excluded | No diff; event unconditional | **FAIL** | `server/controllers/customersController.js:412-444` | MEDIUM | Submit unchanged form; expect no event |
| T06 | Status changes audited | Static S05 found no status-specific event or values | **FAIL** | `server/controllers/customersController.js:422-444` | HIGH | Active→inactive→active with event assertions |
| T07 | Credit-limit changes audited | Static S06 found old/new values on ordinary path | **PASS** (static) | `server/controllers/customersController.js:409-453` | HIGH | Runtime edit plus concurrent-edit test |
| T08 | Total Spent correct/net per policy | Static S08 failed: no confirmed-only/return adjustment | **FAIL** | `server/controllers/customersController.js:100-111` | HIGH | Mixed-status/partial-return fixture |
| T09 | Credit balance correct | Financial fixture not executed; source shows atomic mutation but no independent reconciliation | **NOT TESTED** | `server/services/customerService.js:50-164`; `server/services/reportService.js:961-1013` | CRITICAL | Full AR subledger reconciliation fixture |
| T10 | Last Purchase is latest valid completion | Static S09 failed; uses `created_at` date | **FAIL** | `server/controllers/customersController.js:103-110` | HIGH | Cross-day draft/confirmation fixture |
| T11 | Last Payment is latest successful payment | Static S10 failed; profile omits invoice payments | **FAIL** | `server/controllers/customersController.js:120-123`, `274-302` | HIGH | Checkout + collection + reversal fixture |
| T12 | Invoice count accurate and reconcilable | Includes refunded, tab includes all lifecycle states | **FAIL** | `server/controllers/customersController.js:100-111`, `619-646` | MEDIUM | One row per lifecycle status |
| T13 | AOV uses canonical net numerator/denominator | Gross eligible average; no returns | **FAIL** | `server/controllers/customersController.js:103-109` | HIGH | Mixed status/return/zero-value fixture |
| T14 | Customer Since uses immutable creation time | Static S02/S15 path confirms preserved `created_at` | **PASS** (static) | `server/db/migrations/005_customers.sql:18`; `server/controllers/customersController.js:412-437` | MEDIUM | Edit/deactivate/restore and compare timestamp |
| T15 | Status card reflects DB state | UI maps authoritative `is_active` | **PASS** (static) | `server/controllers/customersController.js:60`; `web/app/(dashboard)/customers/[id]/page.tsx:381-385` | MEDIUM | Cross-role lifecycle test |
| T16 | Partial payment updates balance | Not executed; source locks, validates, and commits atomically | **NOT TESTED** | `server/services/customerService.js:50-164` | CRITICAL | AED 100 debt, AED 30 then AED 70 collections |
| T17 | Refunds update customer statistics | Main statistics never join returns | **FAIL** | `server/controllers/customersController.js:100-111`; `server/services/returnService.js:1023-1078` | HIGH | Partial/full refund fixture across modules |
| T18 | Cancelled invoices handled consistently | Main cards exclude them; tab includes them without lifecycle label | **FAIL** | `server/controllers/customersController.js:100-111`, `619-646`; `web/app/(dashboard)/customers/[id]/page.tsx:513-517` | MEDIUM | Cancel a paid/unpaid invoice and reconcile screens |
| T19 | Concurrent edits preserve history | No lock/version/transaction; stale full overwrite | **FAIL** | `server/controllers/customersController.js:384-454` | HIGH | Barrier-controlled dual PUT requests |
| T20 | Failed updates create no false events | Fault behavior not executed | **NOT TESTED** | audit follows update at `server/controllers/customersController.js:412-444` | HIGH | Validation, SQL, audit, and response fault injection |
| T21 | Successful update cannot lose audit | Static S07/S16 failed; audit catches failure | **FAIL** | `server/utils/activityLog.js:12-29`; `server/controllers/customersController.js:412-454` | CRITICAL | Deny audit INSERT and require rollback |
| T22 | User soft deletion preserves attribution | User is deactivated, not deleted; FK remains | **PASS** (static) | `server/controllers/usersController.js:310-323`; `server/db/migrations/001_init.sql:89` | MEDIUM | Deactivate actor and read historical event |
| T23 | Customer soft deletion preserves history | Static S15 confirms `is_active=false`, no customer delete | **PASS** (static) | `server/controllers/customersController.js:464-498` | HIGH | Deactivate zero-balance customer; inspect all FKs |
| T24 | Multiple terminals reconcile state | Static S14 failed; only balance event subscribed | **FAIL** | `web/app/(dashboard)/customers/[id]/page.tsx:156-178`; `web/store/socketStore.ts:243-251,377-390` | HIGH | Two-browser LAN event matrix + reconnect |
| T25 | Timeline matches authoritative events | Static corrected S11 failed; invalid column and omissions | **FAIL** | `server/controllers/customersController.js:791-851`; `server/db/migrations/006_invoices.sql:3-31` | CRITICAL | Migrated DB endpoint + full lifecycle comparison |
| T26 | Cards match accounting reports | Definitions differ by status/date/returns | **FAIL** | `server/controllers/customersController.js:100-123`; `server/services/reportService.js:914-958`; `server/services/analyticsService.js:413-460` | HIGH | Golden-ledger cross-module fixture |
| T27 | Unauthorized edit rejected backend-side | Static S13 confirms auth + permission middleware | **PASS** (static) | `server/routes/customers.js:7-22`; `server/middleware/permissions.js:5-21` | HIGH | 401/403 integration tests and unchanged row |
| T28 | Duplicate requests are idempotent | No idempotency key; app-only canonical phone pre-check | **FAIL** | `server/controllers/customersController.js:157-176`, `335-378`; `server/db/migrations/005_customers.sql:8` | HIGH | Parallel create/edit retry test |

## 18. Critical Findings

1. **F01 — Audit loss after committed mutations.** Required customer/payment evidence can be silently absent because activity logging is separate and catches all failures.
2. **F02 — Timeline is structurally broken.** The query references a nonexistent invoice column, and the UI hides the failure.
3. **F03/F06 — Modification evidence is inadequate.** General edits lack exact deltas, no-op saves generate noise, and concurrent stale edits overwrite newer state.
4. **F04/F05/F15/F17 — Financial cards are semantically wrong or incomplete.** Refunds/returns are not netted, purchase timestamp is wrong, and invoice payments are omitted.
5. **F07 — LAN terminals do not converge automatically for most profile changes.** Only role-limited balance events trigger a profile reload.
6. **F14/F26 — Inactive-state enforcement and deactivation serialization are incomplete.** New credit can race with or bypass inactivity controls.

## 19. Prioritized Recommendations — DO NOT IMPLEMENT

### Priority 0 — Required before financial/audit reliance

1. Make customer creation, edits, status changes, collections, reversals, and their required domain/audit events one PostgreSQL transaction. Required event failure must roll back the mutation.
2. Replace generic update logging with normalized field diffs containing exact old/new values, stable actor ID, event-time identity, server timestamp, source/request ID, and reason where required.
3. Fix the Timeline query and build it from immutable domain events. Surface load failures and add cursor pagination.
4. Define canonical financial metrics and use shared backend implementations. Distinguish gross confirmed sales, net sales after returns, cash collected, outstanding AR, credit limit, and available credit.
5. Unify successful payment history across `invoice_payments`, `customer_payments`, refunds, and reversals; preserve voided records rather than deleting them.

### Priority 1 — Required before multi-terminal rollout

6. Add optimistic concurrency/version checks for edits and serialize deactivation with credit mutations. Validate `is_active` during invoice confirmation.
7. Emit post-commit customer/version events for create/edit/status/invoice/payment/return changes; subscribe open profiles and tabs, and reconcile on reconnect/focus.
8. Add an independent AR reconciliation from source transactions to `customers.credit_balance` and GL/treasury.
9. Add idempotency keys and a database-enforced canonical phone key.

### Priority 2 — Evidence quality and usability

10. Expose creator ID/name under permission control; display event date and time in the store timezone.
11. Show invoice lifecycle status separately from payment status; label eligible counts clearly.
12. Rename Credit Balance to Outstanding Balance and display credit limit/headroom separately.
13. Enforce append-only audit privileges/tamper evidence and alert on audit pipeline failures.
14. Add pagination to large customer invoice, payment, and timeline histories.

### Required regression suite

Build a dedicated isolated PostgreSQL suite for T01-T28, including concurrency barriers, retry/idempotency, audit fault injection, cross-module golden-ledger reconciliation, and two-browser Socket.IO/reconnect tests. Never run it against production.

## 20. Production Readiness Verdict

**Verdict: NO — not production-ready for reliable customer financial summaries, forensic audit history, or automatic multi-terminal consistency.** Core authentication and balance-collection transaction controls are useful foundations, but the confirmed critical and high findings can misstate customer history, lose required audit evidence, hide timeline failure, and leave terminals stale.

### Mandatory final answers

| # | Required question | Answer | Evidence |
|---:|---|---|---|
| 1 | Is Total Spent correct? | **NO** | Gross non-draft/non-cancelled invoices; includes refunded and ignores returns (`server/controllers/customersController.js:100-111`). |
| 2 | Is Credit Balance correct? | **PARTIAL** | Strong transactional mutation paths, but it is a maintained debt snapshot with no independent reconciliation (`server/services/customerService.js:50-164`; `server/services/reportService.js:961-1013`). Runtime data was not verified. |
| 3 | Is Last Purchase correct? | **NO** | Uses `MAX(created_at)::date`, not `confirmed_at` (`server/controllers/customersController.js:103-110`). |
| 4 | Is Last Payment correct? | **NO** | Profile sees only `customer_payments`, omitting checkout payments (`server/controllers/customersController.js:120-123`, `274-302`). |
| 5 | Is Invoices Count correct? | **PARTIAL** | Counts one row per non-draft/non-cancelled invoice, but includes refunded and does not reconcile with the all-status tab (`server/controllers/customersController.js:100-111`, `619-646`). |
| 6 | Is Average Order Value correct? | **PARTIAL** | Numerator/denominator align, but both are gross and return-unaware (`server/controllers/customersController.js:103-109`). |
| 7 | Is Customer Since correct? | **YES** (source-supported) | Database `created_at` is preserved and rendered (`server/db/migrations/005_customers.sql:18`; `web/app/(dashboard)/customers/[id]/page.tsx:387-390`). No runtime record was inspected. |
| 8 | Is Customer Status correct? | **PARTIAL** | Card reflects DB `is_active`, but status auditing/synchronization is incomplete and credit confirmation does not enforce active state (`server/controllers/customersController.js:384-454`; `server/services/customerService.js:280-306`). |
| 9 | Is the creator’s user ID saved? | **YES** (source-supported) | `created_by` FK is populated from `req.user.id` (`server/db/migrations/005_customers.sql:17`; `server/controllers/customersController.js:348-365`). |
| 10 | Is customer creation date and time saved? | **YES** (source-supported) | Database `TIMESTAMPTZ DEFAULT NOW()` (`server/db/migrations/005_customers.sql:18`). |
| 11 | Is customer creation recorded in Audit Log? | **PARTIAL** | A write is attempted, but it is incomplete, non-atomic, and silently lossy (`server/controllers/customersController.js:368-374`; `server/utils/activityLog.js:12-29`). |
| 12 | Is every customer modification recorded? | **NO** | Audit failure is swallowed; only generic update plus credit-limit-specific event exists (`server/utils/activityLog.js:12-29`; `server/controllers/customersController.js:439-453`). |
| 13 | Are exact old values preserved? | **NO** | Only old credit limit is saved (`server/controllers/customersController.js:445-453`). |
| 14 | Are exact new values preserved? | **NO** | Only new credit limit is saved (`server/controllers/customersController.js:445-453`). |
| 15 | Is the editing employee identified? | **YES** when audit exists | `performedBy` comes from authenticated `req.user.id` (`server/controllers/customersController.js:439-450`). |
| 16 | Is the modification date and time preserved? | **PARTIAL** | Customer `updated_at` and audit timestamp are DB-generated, but the audit can be missing and UI does not expose full edit history (`server/controllers/customersController.js:423`; `server/db/migrations/001_init.sql:90`). |
| 17 | Are concurrent edits handled correctly? | **NO** | No version, lock, or transaction; full stale rows overwrite newer data (`server/controllers/customersController.js:384-437`). |
| 18 | Can audit records be silently lost? | **YES** | `logActivity()` catches and warns without failing the mutation (`server/utils/activityLog.js:12-29`). |
| 19 | Does employee soft deletion preserve audit attribution? | **YES** for stable user ID, **PARTIAL** for historical display | User rows are deactivated, so FK remains; displayed username is current, not snapshotted (`server/controllers/usersController.js:310-323`; `server/controllers/customersController.js:809-820`). |
| 20 | Are cards consistent with invoices, payments, returns, and accounting? | **NO** | Status, date, returns, and payment-source definitions differ across modules (`server/controllers/customersController.js:100-123`, `709-748`; `server/services/reportService.js:914-958`). |
| 21 | Does the Timeline display the correct historical events? | **NO** | Invalid invoice column, suppressed error, and major event omissions (`server/controllers/customersController.js:791-851`; `web/app/(dashboard)/customers/[id]/page.tsx:860-896`). |
| 22 | Are values synchronized correctly between POS terminals? | **NO** | Only Manager/Admin balance events reload the profile; edits, invoices, returns, statuses, and tabs remain stale (`web/app/(dashboard)/customers/[id]/page.tsx:156-178`; `server/controllers/customerPaymentsController.js:82-95`). |
| 23 | Can unauthorized users edit customer information? | **NO** (source-supported) | Auth and `customer.edit` are backend-enforced (`server/routes/customers.js:7-22`; `server/middleware/permissions.js:5-21`). Runtime penetration testing was not performed. |
| 24 | Are financial values calculated from authoritative backend data? | **PARTIAL** | They originate from PostgreSQL/backend queries, but several formulas are incomplete or inconsistent (`server/controllers/customersController.js:100-133`). |
| 25 | Is the Customer Profile module production-ready? | **NO** | Critical audit-loss and timeline failures plus high financial, concurrency, and synchronization defects remain (`server/utils/activityLog.js:12-29`; `server/controllers/customersController.js:791-851`). |

### Evidence limitations

- No read-only production database authorization was provided, so actual row quality, balances, timestamps, and historical audit completeness were not inspected.
- No verified isolated PostgreSQL endpoint was configured, so the existing integration test at `tests/integration/customerSummary.test.js:1-106` was not run.
- No services, containers, users, permissions, sessions, or records were changed; no LAN latency or browser propagation measurement was performed.
- Conclusions marked **CONFIRMED** are direct source/schema contradictions or explicit control behavior. **CODE-SUPPORTED RISK** requires runtime reproduction before claiming occurrence in existing data.
