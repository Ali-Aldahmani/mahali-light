# Purchase Order, Inventory and Payment Audit

Audit date: **23 October 2026**. Repository: `D:/Projects/mahali-light/`. Inspected working tree based on commit `4b2190368559e3a8e3426adb4048e2dd71b757cf`; existing uncommitted changes were included in the review and left untouched.

## 1. Executive Summary

**Verdict: the complete PO lifecycle is not ready for production sign-off for reliable inventory and financial auditability.** The core receiving path does increase stock and creates stock movements inside a database transaction. The normal partial-receiving example and AED 57.75 payment example passed isolated in-memory checks. However, duplicate partial requests are applied twice, payment reversals can credit the wrong bank account, cheque payments can mark a PO paid without accounting entries, payment records are deleted on reversal, and the actual PO supplier-return path reduces stock without the corresponding accounting entries.

The implementation has meaningful safeguards: authenticated actor IDs, PostgreSQL row locks on POs and variants, backend quantity/balance validation, database timestamp defaults, stock movement before/after quantities, and shared transaction clients for receiving and cash/bank payment accounting. These safeguards do not establish idempotency, immutable history, FIFO valuation, or reliable cross-terminal reconciliation.

**Evidence limits:** this was a source, migration and existing-test review plus 33 executed, isolated checks using the repository's actual JavaScript functions with a fake PostgreSQL client and in-memory SQL model: **17 PASS and 16 FAIL**. PASS means only the assertion stated in that isolated check passed. No live database, Docker service, browser session or LAN terminal was exercised. Actual PostgreSQL locking, durable commits, migration deployment, end-to-end rendering, event delivery and latency are **NOT TESTED**. These failures are audit assertions detecting defects; they are not results from the repository's integration suite.

**Read-only compliance:** no application code, database data/schema, configuration, packages or services were changed. No real PO, receipt, payment, user or session was created or changed. Only this report was created. The earlier presence audit and unrelated working-tree changes were left untouched. The executable harness ran from standard input, wrote no files, and used explicit module stubs that prevented application database/network connections. Its source and test-boundary details are retained below.

Confidence vocabulary:

- **CONFIRMED:** directly established from inspected source/schema, or reproduced at the explicitly described isolated boundary. It does not imply a production incident.
- **CODE-SUPPORTED RISK:** the code admits the scenario, but deployment, timing or real database behavior has not been exercised.
- **HYPOTHESIS:** requires evidence beyond this review. No hypothesis is presented as a confirmed defect.

## 2. Discovered Architecture

| Layer | Discovery and evidence |
|---|---|
| Frontend | Next.js 15, React 18, TypeScript, Axios and Zustand; Socket.IO client. [web/package.json:1](<D:/Projects/mahali-light/web/package.json:1>) |
| PO backend | Node.js/Express, Zod validation, raw parameterized SQL through `pg`. No ORM in this write path. [package.json:36](<D:/Projects/mahali-light/package.json:36>), [server/controllers/purchaseOrdersController.js:1](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:1>), [server/db/postgres.js:1](<D:/Projects/mahali-light/server/db/postgres.js:1>) |
| Database/deployment | Docker Compose declares PostgreSQL 16 with persistent storage and web/API/reverse-proxy services. This is declared configuration, not a verified running deployment. [docker-compose.yml:1](<D:/Projects/mahali-light/docker-compose.yml:1>) |
| Optional backend | FastAPI/SQLAlchemy exists as an optional sidecar, not the PO controller/service implementation. [backend-fastapi/pyproject.toml:7](<D:/Projects/mahali-light/backend-fastapi/pyproject.toml:7>) |
| Authentication/authorization | Server-authenticated `req.user`; routes require supplier view, PO create/receive, or PO pay permission. [server/middleware/auth.js:73](<D:/Projects/mahali-light/server/middleware/auth.js:73>), [server/routes/purchaseOrders.js:10](<D:/Projects/mahali-light/server/routes/purchaseOrders.js:10>), [server/routes/supplierPayments.js:10](<D:/Projects/mahali-light/server/routes/supplierPayments.js:10>) |
| Transaction engine | `withTransaction` obtains one client and issues BEGIN, COMMIT or ROLLBACK, releasing it in finally. Pool maximum is 10. No per-operation isolation override or deadlock retry appears in this wrapper. [server/db/postgres.js:8](<D:/Projects/mahali-light/server/db/postgres.js:8>), [server/db/postgres.js:52](<D:/Projects/mahali-light/server/db/postgres.js:52>) |
| Time handling | Store timezone defaults to Asia/Dubai; PostgreSQL connection timezone is configured; event timestamps are TIMESTAMPTZ. Business dates remain DATE. [server/utils/dates.js:18](<D:/Projects/mahali-light/server/utils/dates.js:18>), [server/db/postgres.js:8](<D:/Projects/mahali-light/server/db/postgres.js:8>) |
| Live updates | Socket.IO events trigger local buses/refetches; no durable PO event replay or PO polling/reconnect reconciliation was found in the inspected flow. [web/store/socketStore.ts:107](<D:/Projects/mahali-light/web/store/socketStore.ts:107>), [web/store/socketStore.ts:204](<D:/Projects/mahali-light/web/store/socketStore.ts:204>) |

### End-to-end flows

**Create:** new-PO page → `web/services/purchaseOrderService.ts` → authenticated POST route → controller validation → transaction → unique document number, PO header and items → server total/VAT recalculation → COMMIT → best-effort activity log → socket event → response. [web/app/(dashboard)/purchase-orders/new/page.tsx:164](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:164>), [web/services/purchaseOrderService.ts:52](<D:/Projects/mahali-light/web/services/purchaseOrderService.ts:52>), [server/controllers/purchaseOrdersController.js:262](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:262>), [server/utils/docNumbers.js:25](<D:/Projects/mahali-light/server/utils/docNumbers.js:25>).

**Receive:** Receive Items dialog → receive API → controller injects authenticated actor → service locks PO, each requested item and variant → increases stock, inserts stock movement, increases cumulative PO received quantity, inserts cost history, replaces current variant cost, updates PO status and posts receipt journal → COMMIT → activity log and socket events → response. [web/components/purchases/ReceiveItemsSlideOver.tsx:71](<D:/Projects/mahali-light/web/components/purchases/ReceiveItemsSlideOver.tsx:71>), [server/controllers/purchaseOrdersController.js:520](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:520>), [server/services/purchaseOrderService.js:93](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:93>), [server/services/stockService.js:92](<D:/Projects/mahali-light/server/services/stockService.js:92>).

**Pay:** Add Payment dialog → payment API → controller injects authenticated actor → service locks PO and validates current balance → inserts supplier payment, updates PO totals, records treasury and journal for cash/bank → COMMIT → best-effort activity log and socket event → response. Cheques bypass treasury/journal. [web/components/purchases/AddPaymentSlideOver.tsx:63](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:63>), [server/controllers/supplierPaymentsController.js:65](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:65>), [server/services/supplierPaymentService.js:51](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:51>).

### Main persisted relationships

| Record | Persisted fields and relationship |
|---|---|
| `purchase_orders` | UUID, unique PO number, supplier FK, creator `employee_id` **referencing users.id**, order/expected/received/due dates, status, totals, paid and balance, created/updated TIMESTAMPTZ. [server/db/migrations/004_suppliers.sql:19](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:19>) |
| `purchase_order_items` | PO FK, independent product and variant FKs, ordered quantity, unit, unit cost, line total, cumulative quantity_received. [server/db/migrations/004_suppliers.sql:41](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:41>) |
| `product_variants` | Global `stock_qty` and current `cost_price`; no PO warehouse dimension. [server/db/migrations/002_products.sql:64](<D:/Projects/mahali-light/server/db/migrations/002_products.sql:64>) |
| `stock_movements` | Quantity, qty_before, qty_after, product/variant, polymorphic PO reference, actor user FK and TIMESTAMPTZ. [server/db/migrations/003_stock.sql:5](<D:/Projects/mahali-light/server/db/migrations/003_stock.sql:5>) |
| `product_cost_history` | Product/variant, PO, supplier, unit cost, quantity bought, actor, date and created timestamp. [server/db/migrations/004_suppliers.sql:68](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:68>) |
| `supplier_payments` | PO/supplier, amount, method, nullable bank ID, payment DATE, actor user FK, notes/attachment and created TIMESTAMPTZ. [server/db/migrations/004_suppliers.sql:54](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:54>) |
| `activity_log` | Polymorphic entity, action, actor user FK, timestamp and optional old/new JSON. [server/db/migrations/001_init.sql:84](<D:/Projects/mahali-light/server/db/migrations/001_init.sql:84>) |
| Accounting | Journal headers/lines and cash/bank transactions; journal reference is polymorphic rather than an enforced PO/payment FK. [server/db/migrations/013_finance.sql:38](<D:/Projects/mahali-light/server/db/migrations/013_finance.sql:38>), [server/services/journalService.js:590](<D:/Projects/mahali-light/server/services/journalService.js:590>) |

## 3. Purchase Order Creation Findings

The backend saves the authenticated creator in `purchase_orders.employee_id`, whose FK points to `users.id`. Its name is misleading, but it is a stable user identifier. It does not accept a client-supplied creator or created timestamp. `created_at` and `updated_at` use database TIMESTAMPTZ defaults. `order_date` is a business DATE supplied by the user or defaulted by the backend. Confirmation separately sets `confirmed_at = NOW()`; there is no full `ordered_at` timestamp. Existing POs pre-dating the confirmed_at migration can have null confirmation time because the migration does not backfill it. [server/controllers/purchaseOrdersController.js:285](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:285>), [server/db/migrations/004_suppliers.sql:23](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:23>), [server/db/migrations/004_suppliers.sql:37](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:37>), [server/controllers/purchaseOrdersController.js:501](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:501>), [server/db/migrations/035_po_confirmed_at.sql:11](<D:/Projects/mahali-light/server/db/migrations/035_po_confirmed_at.sql:11>).

Creation validates an active supplier and creates the header and item rows in one transaction. Supplier validation is performed before that transaction, so concurrent supplier disabling is not protected by that validation. The document counter is incremented atomically and PO number has a unique constraint. Product/variant relationship validation is incomplete (F02). Database/default timestamp generation and document-number contention were not executed against PostgreSQL.

### F01 — Mutating requests have no idempotency contract

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** [server/services/purchaseOrderService.js:126](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:126>) processes each receipt again when quantity remains; [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>) inserts another payment whenever balance allows; [server/controllers/purchaseOrdersController.js:285](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:285>) allocates another PO for another create request. The schema has no receipt/payment request key or uniqueness constraint for these operations ([server/db/migrations/004_suppliers.sql:19](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:19>)). The HTTP timeout action replays the request, including POST ([web/services/http.ts:45](<D:/Projects/mahali-light/web/services/http.ts:45>)). I06, I07 and I15 reproduced duplicate receipt lines and duplicate partial payments in memory.
- **Business impact:** A retry after a committed but lost response, repeated submission or duplicate item ID can inflate inventory or record the same transfer twice. Over-receipt/overpayment checks only stop duplicates that exhaust the remaining allowance.
- **Recommended fix (not implemented):** Use a caller-stable operation ID, unique operation record and payload hash inside the business transaction; return the original result on retries. Reject repeated PO item IDs within one receipt. Recover ambiguous outcomes by operation ID before offering another write.
- **Verification:** In an isolated PostgreSQL environment, send identical operation IDs sequentially and concurrently, disconnect after commit, then retry. Assert one receipt/payment/movement/journal set and an identical response; a genuinely new operation ID must allow a legitimate second partial receipt.


### F02 — Product and variant ownership can disagree

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** The create schema accepts independent UUIDs ([server/controllers/purchaseOrdersController.js:18](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:18>)), cost resolution looks up only variant ID ([server/services/purchaseOrderService.js:40](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:40>)), and insertion uses both client values ([server/controllers/purchaseOrdersController.js:313](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:313>)). The schema has separate FKs without a product/variant ownership constraint ([server/db/migrations/004_suppliers.sql:43](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:43>)). Stock service updates the variant but prefers supplied productId for its movement ([server/services/stockService.js:135](<D:/Projects/mahali-light/server/services/stockService.js:135>)). I10 reproduced a movement attributed to product B while stock belongs to a variant of product A.
- **Business impact:** Stock counts, product history, supplier costing and audit reports can refer to different products for one receipt. A valid UUID is not proof of ownership.
- **Recommended fix (not implemented):** Derive product ID from the locked variant, validate consistency on create/edit and service entry, and enforce the relationship in the database.
- **Verification:** Create/edit a PO with two valid but mismatched IDs in a disposable DB; expect rejection before any row or counter change. Verify correct pairs produce matching item, stock and movement identities.


### F03 — Frontend tax/shipping preview does not match the backend contract

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** The new page totals client-entered taxAmount and exposes a tax/shipping field ([web/app/(dashboard)/purchase-orders/new/page.tsx:95](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:95>), [web/app/(dashboard)/purchase-orders/new/page.tsx:403](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:403>)). The create schema does not declare this field ([server/controllers/purchaseOrdersController.js:26](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:26>)); backend totals instead use VAT settings ([server/services/purchaseOrderService.js:26](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:26>), [server/services/purchaseOrderService.js:58](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:58>)). I27/I28 verified backend VAT calculation and stripping/omission of client extras at the isolated boundary.
- **Business impact:** The amount shown while entering a PO can differ from its saved total. Shipping is not persisted as a separately identified cost and cannot be reconciled from this field.
- **Recommended fix (not implemented):** Define a single server-priced PO preview and explicit VAT/shipping fields with an approved accounting treatment; render the returned totals.
- **Verification:** Enter a nonzero tax/shipping value and compare preview, request, persisted fields and journal basis against the agreed contract in a sandbox.


### F04 — Draft deletion is logged as cancellation, without preserving the PO

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** [server/controllers/purchaseOrdersController.js:453](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:453>) permits only draft deletion; [server/controllers/purchaseOrdersController.js:460](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:460>) physically deletes the header, cascading items through [server/db/migrations/004_suppliers.sql:43](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:43>). The post-delete activity action is purchase_order.cancelled ([server/controllers/purchaseOrdersController.js:468](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:468>)). No confirmed-PO cancellation transition is exposed by [server/routes/purchaseOrders.js:12](<D:/Projects/mahali-light/server/routes/purchaseOrders.js:12>).
- **Business impact:** A cancelled draft cannot be reconstructed from its retained header/items. The event name implies a retained cancellation state that this endpoint does not create. Payment FKs can instead block deletion of a paid draft.
- **Recommended fix (not implemented):** Keep cancelled PO headers/items with cancellation actor, timestamp and reason; distinguish draft deletion from cancellation if deletion is an intentional policy. Define cancellation behavior for confirmed/partially received/paid POs.
- **Verification:** Cancel an unpaid draft and attempt cancellation at each later state; verify durable history and explicit stock/payment reversal policy. Confirm no deletion cascades erase the audit basis.


### F05 — Partial draft updates erase omitted dates and notes

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** Although the update schema is partial ([server/controllers/purchaseOrdersController.js:42](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:42>)), the update SQL assigns expected_date, due_date and notes using values defaulted to null ([server/controllers/purchaseOrdersController.js:387](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:387>)). A notes-only update can clear existing dates. The existing notes-only test does not assert date preservation ([tests/integration/purchaseOrders.test.js:117](<D:/Projects/mahali-light/tests/integration/purchaseOrders.test.js:117>)).
- **Business impact:** Editing one field can silently remove delivery/payment scheduling data.
- **Recommended fix (not implemented):** Distinguish omitted fields from explicit null and preserve omitted values; record changed fields in audit metadata.
- **Verification:** Save both dates, PATCH only notes and verify both dates remain. Explicitly clear one date and verify only that field becomes null.


## 4. Receive Items and Inventory Findings

**The actual inventory column is `product_variants.stock_qty`.** The stock service locks the variant, reads its current quantity, computes current + received, updates that column and inserts `stock_movements` using the same transaction client. The PO item update independently increments `purchase_order_items.quantity_received`; ordered quantity remains unchanged. [server/services/stockService.js:122](<D:/Projects/mahali-light/server/services/stockService.js:122>), [server/services/stockService.js:144](<D:/Projects/mahali-light/server/services/stockService.js:144>), [server/services/stockService.js:172](<D:/Projects/mahali-light/server/services/stockService.js:172>), [server/services/stockService.js:196](<D:/Projects/mahali-light/server/services/stockService.js:196>), [server/services/stockService.js:216](<D:/Projects/mahali-light/server/services/stockService.js:216>), [server/services/purchaseOrderService.js:178](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:178>).

The isolated example executed actual services and produced:

| Step | Inventory | Cumulative PO received | Remaining | PO status |
|---|---:|---:|---:|---|
| Initial fixture: ordered 55 | 20 | 0 | 55 | confirmed |
| Receive 30 | 50 | 30 | 25 | partially_received |
| Receive remaining 25 | 75 | 55 | 0 | received |

This is **I01 PASS in an in-memory SQL model**, not proof of persisted production values. Each accepted receipt line generated a movement with before/after, PO reference, actor and a server-clock timestamp (I02). The UI awaits backend completion before success and reloads server data; no optimistic stock increment is performed in this dialog. [web/components/purchases/ReceiveItemsSlideOver.tsx:71](<D:/Projects/mahali-light/web/components/purchases/ReceiveItemsSlideOver.tsx:71>).

| Required receiving question | Answer |
|---|---|
| Actual inventory increases? | YES, in service code and isolated I01. Live persistence NOT TESTED. |
| Added to previous quantity? | YES under the variant lock; precision/retries qualify correctness (F01/F06). |
| Correct product? | Intended by variant ID; independent product ID can disagree (F02). |
| Correct branch/warehouse? | NOT VERIFIED / not representable in this model: one global balance per variant. |
| Received distinct from ordered? | YES, cumulative quantity_received is separate. |
| Every operation retained? | PARTIAL: movement and cost rows exist per line, but no durable receipt header/batch/line ID grouping; payment reversal has separate retention problems. |
| Receiver/time/per-product quantity? | YES in stock_movements and cost history; not in a dedicated receiving-event API. |
| Receipt audit event? | Best-effort purchase_order.received, sparse and outside the transaction (F11). |
| Movement linked to PO? | YES by reference_type/reference_id; not a relational FK or PO-item/receipt-line ID. |
| Atomic? | Core stock/item/cost/status/journal writes share a transaction. Audit, events and final response queries are outside it. |

There is **no location-aware stock balance** in this path: stock is keyed by variant, and receive requests carry no branch/warehouse/location. This is sufficient only if all LAN terminals intentionally share one stock location. If separate locations are required, severity **MEDIUM**, confidence **CONFIRMED** for the model limitation: [server/db/migrations/002_products.sql:66](<D:/Projects/mahali-light/server/db/migrations/002_products.sql:66>), [server/controllers/purchaseOrdersController.js:44](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:44>), [server/services/stockService.js:196](<D:/Projects/mahali-light/server/services/stockService.js:196>). Impact: goods cannot be attributed to a receiving location. Recommendation: define location policy and add location-keyed balances/movements before multiple warehouses are enabled. Verification: receive the same SKU into two locations and reconcile separate balances in a future isolated implementation; **NOT TESTED** here.

## 5. Partial Receiving Findings

The service permits confirmed and partially_received POs only, locks the PO and each item, checks remaining quantity and rejects over-receipt. The UI defaults to remaining quantities and clamps entered amounts; the backend is the final enforcement point. [server/services/purchaseOrderService.js:105](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:105>), [server/services/purchaseOrderService.js:112](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:112>), [server/services/purchaseOrderService.js:132](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:132>), [server/services/purchaseOrderService.js:146](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:146>), [web/components/purchases/ReceiveItemsSlideOver.tsx:39](<D:/Projects/mahali-light/web/components/purchases/ReceiveItemsSlideOver.tsx:39>).

After each receipt it reads all items and updates status to partially_received or received; received_date is set only upon full receipt and is DATE, not the timestamp of each partial delivery. [server/services/purchaseOrderService.js:249](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:249>), [server/services/purchaseOrderService.js:271](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:271>). Different sessions/employees can receive successive partial quantities; each movement actor is supplied by authenticated req.user. The same actor is not required for all receipts.

Zero/negative quantities are rejected by the HTTP schema (I05). Receipt attempts for draft/cancelled/received/closed states were rejected in the model (I04); “closed” is a tested arbitrary status, not a supported PO lifecycle state discovered in the application.

### F06 — Quantity scale and whole-unit rules are not enforced consistently

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** The API uses positive numbers without quantity scale or product-unit validation ([server/controllers/purchaseOrdersController.js:44](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:44>)), the UI uses step 0.01 ([web/components/purchases/ReceiveItemsSlideOver.tsx:147](<D:/Projects/mahali-light/web/components/purchases/ReceiveItemsSlideOver.tsx:147>)), the stock engine rounds to four decimals ([server/services/stockService.js:192](<D:/Projects/mahali-light/server/services/stockService.js:192>)), and item/movement/stock columns store two decimals ([server/db/migrations/004_suppliers.sql:46](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:46>), [server/db/migrations/003_stock.sql:10](<D:/Projects/mahali-light/server/db/migrations/003_stock.sql:10>), [server/db/migrations/002_products.sql:66](<D:/Projects/mahali-light/server/db/migrations/002_products.sql:66>)). I29 confirmed 0.004 is accepted by the HTTP schema. PostgreSQL rounding effects were not executed.
- **Business impact:** Unsupported precision may be accepted but rounded differently at storage boundaries; many small receipts can lose quantity or disagree with cumulative totals. Counted products can receive fractional units unless another policy is enforced outside this path.
- **Recommended fix (not implemented):** Specify allowed scale per unit, reject unsupported precision before calculations, use consistent exact decimal arithmetic and storage, and enforce whole-unit quantities where required.
- **Verification:** In isolated PostgreSQL, test 0.004, 0.005, repeated fractional receipts and piece versus weight units; assert no accepted nonzero receipt vanishes and stock, movements and PO totals reconcile exactly.


## 6. Concurrency and Duplicate Submission Findings

**Row locks address ordinary lost updates, but do not identify duplicate business actions.** The PO FOR UPDATE lock serializes receiving/payment operations on one PO. Each product variant is also locked, so different POs updating one variant should read the latest committed balance rather than overwrite a stale value. I32 executed those lock statements on one fake client; actual blocking/isolation was **NOT TESTED**. [server/services/purchaseOrderService.js:105](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:105>), [server/services/purchaseOrderService.js:132](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:132>), [server/services/stockService.js:122](<D:/Projects/mahali-light/server/services/stockService.js:122>), [server/services/supplierPaymentService.js:53](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:53>).

| Scenario | Code-supported outcome / limit |
|---|---|
| Two employees, same PO/item | PO lock serializes transactions; the second rechecks remaining quantity. If both identical partial requests fit, both are accepted (F01). |
| Different POs, same variant | Variant lock protects read/add/write; live contention and durable results NOT TESTED. |
| Two different legitimate payments | PO lock rechecks remaining balance. A payment exceeding the refreshed balance is rejected; two affordable payments are both accepted. |
| Two copies of same payment | No unique operation key; two partial payments may both be recorded. |
| Double-click | Loading buttons disable ordinary resubmission after render; this is useful UI protection, not a server guarantee. [web/components/ui/Button.tsx:50](<D:/Projects/mahali-light/web/components/ui/Button.tsx:50>) |
| Timeout/disconnection after commit | API response may be lost; Retry replays the write. A post-commit SELECT failure can also report failure after success. [server/controllers/purchaseOrdersController.js:588](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:588>), [server/controllers/supplierPaymentsController.js:131](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:131>), [web/services/http.ts:45](<D:/Projects/mahali-light/web/services/http.ts:45>) |
| Duplicate full receipt/payment | Remaining/state validation can reject the second request, rather than return the successful first result (I33 for full payment). |
| Opposite item order across two POs | Variants are locked in supplied item order, allowing a lock cycle. PostgreSQL should abort one transaction; no deadlock retry is in the wrapper. Real deadlock behavior NOT TESTED. |
| Journal/treasury failure | Shared client should roll back the core transaction. I25 verified wrapper ROLLBACK/release against a fake client; actual PostgreSQL rollback NOT TESTED. |
| Audit failure | Business action is already committed and audit error is swallowed (F11). |

For unsorted multi-variant locking, **severity MEDIUM, confidence CODE-SUPPORTED RISK**. Evidence: loop [server/services/purchaseOrderService.js:126](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:126>), variant lock [server/services/stockService.js:122](<D:/Projects/mahali-light/server/services/stockService.js:122>), wrapper [server/db/postgres.js:52](<D:/Projects/mahali-light/server/db/postgres.js:52>). Impact: avoidable failed receipts and ambiguous user retries under contention. Recommend deterministic variant lock order and bounded whole-transaction retry only with idempotency protection. Verify two sandbox transactions receiving A/B and B/A, plus concurrent sales/returns against those variants; inspect rollback and exactly-once effects.

## 7. FIFO and Inventory Valuation Findings

### F07 — Valuation uses latest catalog cost; no FIFO layers exist in this path

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Receiving overwrites product_variants.cost_price with the PO unit cost ([server/services/purchaseOrderService.js:207](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:207>)). Stock valuation multiplies remaining stock by current cost ([server/controllers/stockReportsController.js:125](<D:/Projects/mahali-light/server/controllers/stockReportsController.js:125>), [server/services/reportService.js:403](<D:/Projects/mahali-light/server/services/reportService.js:403>)). Sales snapshot the current variant cost, not a FIFO-layer allocation ([server/services/invoiceService.js:164](<D:/Projects/mahali-light/server/services/invoiceService.js:164>), [server/services/invoiceService.js:660](<D:/Projects/mahali-light/server/services/invoiceService.js:660>)). No FIFO receipt layers/consumption implementation was found in the reviewed schema/services. I31 reproduced the valuation formula mismatch.
- **Business impact:** Opening 20 units at AED 5 plus receipt of 30 at AED 10 has historical cost AED 400; latest-cost reporting shows 50 × 10 = AED 500. The receipt journal adds AED 300 without an explicit AED 100 revaluation for the opening units. Inventory reporting can diverge from the ledger; FIFO cannot be claimed.
- **Recommended fix (not implemented):** Choose and document the intended cost method. Implement FIFO layers or consistent weighted average, or explicitly account for revaluations if latest cost is intentional. Preserve costing links through returns and sales.
- **Verification:** In a disposable DB, receive two differently priced lots, sell and return across the lot boundary, and reconcile on-hand valuation to inventory control-account movements and COGS. FIFO is NOT TESTED because no implementation was found.


### F08 — Fractional partial receipts can overstate net inventory/AP journal value

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** receivedValue is rounded from each operation/line ([server/services/purchaseOrderService.js:186](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:186>)), while cumulative VAT is allocated using before/after totals ([server/services/purchaseOrderService.js:236](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:236>)). The receipt journal uses receivedValue ([server/services/purchaseOrderService.js:288](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:288>)). I08 received 0.5 + 0.5 units at AED 0.01 and captured two net journal inputs of AED 0.01, totaling AED 0.02 against a net PO of AED 0.01. Journal persistence itself was stubbed.
- **Business impact:** Accepted fractional receipts can accumulate net accounting rounding differences even though the implemented cumulative VAT allocation passes the tested example (I09).
- **Recommended fix (not implemented):** Allocate both net and VAT from cumulative rounded receipt value differences, use exact decimals and make the final receipt absorb only the approved rounding residual.
- **Verification:** Split fractional-priced orders into many receipts, including multi-line receipts, and assert cumulative net/tax journal amounts equal the final PO totals exactly in actual PostgreSQL.


Historical movement quantity and before/after stock are retained. Historical **value** is weaker: the movement API computes valueImpact using the variant's current joined cost rather than a cost snapshot ([server/controllers/stockMovementsController.js:42](<D:/Projects/mahali-light/server/controllers/stockMovementsController.js:42>)). This is **MEDIUM, CONFIRMED**: a later cost change alters the displayed value of an earlier movement. Cost history preserves receipt unit cost/supplier separately ([server/db/migrations/004_suppliers.sql:68](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:68>)) but lacks a direct movement/receipt-line ID. Recommendation: persist movement valuation and immutable cost-allocation references; verify an old movement's displayed value remains unchanged after receiving a differently priced PO.

## 8. Payment Recording Findings

The payment path creates `supplier_payments` and updates `purchase_orders.amount_paid`, `balance_due` and `payment_status` inside the PO lock transaction. Amount is rounded to two decimals, validated positive/finite, and checked against current balance. Supported methods are cash, bank_transfer and cheque. [server/services/supplierPaymentService.js:8](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:8>), [server/services/supplierPaymentService.js:39](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:39>), [server/services/supplierPaymentService.js:53](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:53>), [server/services/supplierPaymentService.js:75](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:75>), [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>), [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>).

| Isolated payment example | Paid | Balance | Status |
|---|---:|---:|---|
| PO total AED 57.75; first payment AED 20.00 | 20.00 | 37.75 | partial |
| Second payment AED 37.75 | 57.75 | 0.00 | paid |

I11 passed at the service/model boundary. The header is incremented from its locked amount_paid, not recomputed as SUM of retained payment records. This is adequate only if all mutations preserve the invariant; no independent database aggregate constraint enforces it.

Payment actor is server-supplied `req.user.id`; payment_date is a client-selectable **business DATE**, while created_at is an authoritative **recording TIMESTAMPTZ**. There is no separate actual settlement time. Method and optional bank ID are stored; no structured payment/cheque reference field exists, although notes can carry free text. The API returns actor ID/username, payment date, createdAt, notes and bank ID; the table omits several of these (section 12). [server/controllers/supplierPaymentsController.js:15](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:15>), [server/controllers/supplierPaymentsController.js:23](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:23>), [server/controllers/supplierPaymentsController.js:65](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:65>), [server/db/migrations/004_suppliers.sql:54](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:54>).

Cash/bank paths call treasury helpers and journal entry creation with the shared transaction client. The journal service validates debit/credit balance and accounting period, then inserts header/lines. [server/services/supplierPaymentService.js:126](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:126>), [server/services/supplierPaymentService.js:136](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:136>), [server/services/supplierPaymentService.js:152](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:152>), [server/services/journalService.js:220](<D:/Projects/mahali-light/server/services/journalService.js:220>), [server/services/journalService.js:626](<D:/Projects/mahali-light/server/services/journalService.js:626>). Real treasury balances and ledger persistence were **NOT TESTED**.

### F09 — Default bank selection is not saved, allowing reversal into a different bank

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Payment insertion saves the optional caller bankAccountId ([server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>)). The UI does not submit a bank selection ([web/components/purchases/AddPaymentSlideOver.tsx:77](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:77>)). Bank service resolves a default/first active account ([server/services/bankService.js:76](<D:/Projects/mahali-light/server/services/bankService.js:76>)), but that resolved ID is not written back to the payment. Reversal supplies the original nullable ID ([server/services/supplierPaymentService.js:264](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:264>)). I20/I21 reproduced debit from bank A, default change to B, then credit to B: A=980, B=1020 instead of both 1000.
- **Business impact:** Bank balances and the payment record can become inconsistent during a legitimate same-day correction. The PO can appear reversed while money is restored to the wrong account in the books.
- **Recommended fix (not implemented):** Resolve and persist the actual bank account before inserting the payment; link original and reversing treasury transactions by payment ID and reverse the original account deterministically. Add the missing supplier-payment bank FK.
- **Verification:** Pay from the default account without an explicit ID, change the default and reverse in a disposable database. Assert both original and reversal reference bank A and no movement touches B.


### F10 — Cheque payment changes paid totals without a settlement/accounting lifecycle

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** All allowed methods insert a payment and increase amount_paid ([server/services/supplierPaymentService.js:8](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:8>), [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>)), but only cash/bank_transfer enter treasury and payment-journal branches ([server/services/supplierPaymentService.js:126](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:126>), [server/services/supplierPaymentService.js:152](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:152>)). I23 captured a fully paid PO with a cheque and no journal/treasury call. No pending/cleared/bounced cheque transition was found in this workflow.
- **Business impact:** The PO can show Paid while AP remains outstanding in the ledger and no clearing record explains the difference.
- **Recommended fix (not implemented):** Define issued/cleared/bounced cheque states and appropriate clearing accounts, or disable the method until its posting/reversal lifecycle exists.
- **Verification:** Record, clear, bounce and reverse a cheque in a sandbox; reconcile PO paid/balance, AP, cheque clearing and bank entries at every state.


## 9. Payment Edge Cases

Positive two-decimal cash/bank payments and overpayment rejection have sensible service logic. The isolated checks rejected zero, negative, tiny amounts rounding to zero, invalid methods, cancelled-PO payment, and payment above the current balance (I12–I14). HTTP validation and the service layer both contribute; these checks do not prove bank/cash persistence.

| Edge case | Assessment |
|---|---|
| Zero/negative | Rejected. Isolated checks PASS. |
| Amount above balance | Rejected under PO lock; isolated PASS. |
| Duplicate partial payment / retry | Accepted twice while balance permits; isolated FAIL (F01). |
| Concurrent payments | Serialized by PO lock in code; actual concurrent PostgreSQL test NOT TESTED. |
| Cancelled PO | Rejected. |
| Draft / received PO | Allowed; draft mutability introduces F13. There is no separate supported “closed” state gate. |
| Arbitrary other status | Service rejects only cancelled for payment, rather than allowlisting legal states. |
| Precision | Currency rounded to two decimals in JavaScript; no exact decimal library in this path. Normal examples pass; receipt rounding fails (F08). |
| Network failure after commit | Outcome is ambiguous; replay can duplicate. |
| Bank funds | allowOverdraft is explicitly true for supplier payments; this is a policy choice, not proof of insufficient-funds protection. [server/services/supplierPaymentService.js:145](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:145>) |
| Cash funds | Cash helper checks available balance; its real transaction behavior was not executed. [server/services/cashService.js:242](<D:/Projects/mahali-light/server/services/cashService.js:242>) |
| Same-day correction | deletePayment checks recording date in store timezone, not selected payment_date. Earlier-day correction is rejected. [server/services/supplierPaymentService.js:190](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:190>) |
| Refund/credit | Two supplier-return implementations exist; PO-button path does not settle supplier balances/accounting (F15). |

### F12 — Payment correction deletes the original record and misattributes reversal entries

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** deletePayment accepts only paymentId ([server/services/supplierPaymentService.js:179](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:179>)), physically deletes the supplier payment ([server/services/supplierPaymentService.js:211](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:211>)), and passes the original payer to journal/treasury reversals ([server/services/supplierPaymentService.js:241](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:241>), [server/services/supplierPaymentService.js:258](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:258>), [server/services/supplierPaymentService.js:269](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:269>)). The controller knows the reversing user but does not pass it into the service ([server/controllers/supplierPaymentsController.js:158](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:158>)). Its activity_log entry does use the correct current actor ([server/controllers/supplierPaymentsController.js:164](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:164>)). I18/I19 reproduced the service attribution and retention defects.
- **Business impact:** The payment list loses the original payment, journal references point to a deleted payment ID, attachments may be removed, and reversal treasury/journal entries falsely identify the original payer as the person making the correction. Journal reversal entries themselves are retained; this finding does not claim they are deleted.
- **Recommended fix (not implemented):** Keep the original payment with reversal status; create an append-only reversal linked to it with reversing user, time and reason. Preserve receipt evidence and pass authenticated reversing actor to all accounting/treasury writes. Define approved corrections after the same-day window.
- **Verification:** Have user A record a payment and user B reverse it; verify both records and attachments remain, B appears on reversal entries, original journal remains linked, and net PO/treasury/ledger effects are zero.


### F13 — Paid drafts remain editable, including supplier and totals

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Payment state validation rejects only cancelled ([server/services/supplierPaymentService.js:63](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:63>)). Draft update checks only draft status ([server/controllers/purchaseOrdersController.js:378](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:378>)) and allows supplier/item replacement ([server/controllers/purchaseOrdersController.js:387](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:387>), [server/controllers/purchaseOrdersController.js:405](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:405>)). recalculatePOTotals sets balance = total − amount_paid but neither rejects negative balance nor recomputes payment_status ([server/services/purchaseOrderService.js:58](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:58>)). I30 accepted a draft payment then reduced the draft total to 10.50 with 20 paid, leaving balance −9.50.
- **Business impact:** Paid drafts can have negative balances/stale payment status; changing supplier can leave payment.supplier_id attached to the former supplier while the PO points elsewhere. Receipt-based AP recognition also means a payment before receipt debits AP before this PO has recognized its liability.
- **Recommended fix (not implemented):** Define prepayments explicitly, restrict supplier/amount edits once financial records exist, or implement audited amendments with supplier-advance accounting and reconciliation. Recompute status from the final authoritative totals.
- **Verification:** Pay a draft, change supplier, remove items and reduce total below paid in a sandbox. Require rejection or a complete audited adjustment; reconcile supplier subledger and AP/advance accounts.


### F14 — Backdated payment and bank transaction use different business dates

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** Supplier payment and journal use payment_date ([server/services/supplierPaymentService.js:95](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:95>), [server/services/supplierPaymentService.js:157](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:157>)), but recordBankOut receives no transactionDate ([server/services/supplierPaymentService.js:136](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:136>)). The bank service defaults to today ([server/services/bankService.js:163](<D:/Projects/mahali-light/server/services/bankService.js:163>)). I22 reproduced a 20 October payment/journal date and 23 October bank transaction date.
- **Business impact:** Daily bank reconciliation and accounting reports can place the same payment on different dates. created_at still correctly represents recording time; it is not a substitute for consistent business dates.
- **Recommended fix (not implemented):** Pass a validated payment business date consistently to treasury and journal, separately retain recorded_at, and enforce period/backdating policy.
- **Verification:** Record an allowed backdated bank payment and compare payment, bank and journal dates in store timezone; test around midnight and a closed accounting period.


### F15 — The PO supplier-return button bypasses the accounting-capable return flow

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** The PO dialog calls createSupplierReturn ([web/components/purchases/SupplierReturnSlideOver.tsx:9](<D:/Projects/mahali-light/web/components/purchases/SupplierReturnSlideOver.tsx:9>), [web/components/purchases/SupplierReturnSlideOver.tsx:97](<D:/Projects/mahali-light/web/components/purchases/SupplierReturnSlideOver.tsx:97>)) and /supplier-returns. That controller inserts a return and return_out stock movement ([server/controllers/supplierReturnsController.js:179](<D:/Projects/mahali-light/server/controllers/supplierReturnsController.js:179>), [server/controllers/supplierReturnsController.js:240](<D:/Projects/mahali-light/server/controllers/supplierReturnsController.js:240>)); resolution only updates return status/notes ([server/controllers/supplierReturnsController.js:293](<D:/Projects/mahali-light/server/controllers/supplierReturnsController.js:293>)). It has labels refunded/credit_note/replaced/rejected ([server/controllers/supplierReturnsController.js:10](<D:/Projects/mahali-light/server/controllers/supplierReturnsController.js:10>)) but does not post the corresponding journal/treasury/PO balance adjustments. A separate approved-return service DOES post a supplier-return journal ([server/services/returnService.js:1001](<D:/Projects/mahali-light/server/services/returnService.js:1001>)). The VAT integration test exercises that separate service ([tests/integration/purchaseVat.test.js:167](<D:/Projects/mahali-light/tests/integration/purchaseVat.test.js:167>)).
- **Business impact:** Using the PO return UI can reduce physical stock without reducing ledger inventory/AP or recording a supplier refund/credit. A “refunded” resolution can be a label without a financial refund. Passing tests for the other return service would not validate this UI path.
- **Recommended fix (not implemented):** Unify the two flows under one transactional, audited return/credit/refund service with explicit stock, valuation, VAT, AP and treasury effects. Link settlement to the original receipt/payment and preserve credit history.
- **Verification:** Use the actual PO return UI in an isolated environment, partially return a received/paid PO and resolve by refund, credit, replacement and rejection. Reconcile stock, inventory ledger, supplier balances and treasury for each result.


### F16 — New-PO wizard can announce payment success after payment failure

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** Creation, confirmation, optional receiving and payment are separate requests ([web/app/(dashboard)/purchase-orders/new/page.tsx:206](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:206>), [web/app/(dashboard)/purchase-orders/new/page.tsx:223](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:223>), [web/app/(dashboard)/purchase-orders/new/page.tsx:241](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:241>)). The payment catch warns but continues to a success message based on recordPayment rather than actual payment success ([web/app/(dashboard)/purchase-orders/new/page.tsx:251](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:251>), [web/app/(dashboard)/purchase-orders/new/page.tsx:275](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:275>)). I26 executed the extracted actual save function with mocked APIs and reproduced warning followed by “payment recorded” success.
- **Business impact:** A cashier can believe a supplier payment was recorded when it failed. Failure after PO creation can also leave a committed PO while the form invites a complete retry, creating another PO.
- **Recommended fix (not implemented):** Track and display each completed step explicitly, retain the created PO ID, and resume safely from server state. Announce payment success only after that operation succeeds; use idempotent operation IDs for recovery.
- **Verification:** Fail each wizard step in turn, including after backend commit, and inspect messages/navigation and DB counts. Assert payment failure never produces payment-success text and retry resumes the original PO.


The standalone Receive Items and Add Payment dialogs await their respective API before announcing success. Loading disables their buttons; receipt-attachment upload failure is reported separately after payment creation. Their remaining risk is ambiguous post-commit network failure and duplicate retry, not a universal unconditional-success bug. [web/components/purchases/ReceiveItemsSlideOver.tsx:81](<D:/Projects/mahali-light/web/components/purchases/ReceiveItemsSlideOver.tsx:81>), [web/components/purchases/AddPaymentSlideOver.tsx:77](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:77>), [web/components/purchases/AddPaymentSlideOver.tsx:85](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:85>).

## 10. Audit Log Integrity

### F11 — Audit persistence is best-effort, outside the business transaction and incomplete

- **Severity:** HIGH. **Confidence:** CONFIRMED.
- **Evidence:** logActivity inserts using the global pool and catches errors without propagating them ([server/utils/activityLog.js:12](<D:/Projects/mahali-light/server/utils/activityLog.js:12>)). Controllers call it after business COMMIT ([server/controllers/purchaseOrdersController.js:330](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:330>), [server/controllers/purchaseOrdersController.js:532](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:532>), [server/controllers/supplierPaymentsController.js:80](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:80>)). I24 made the insert fail and observed the helper resolve after warning. Receipt notes contain line count, not per-product changes; payment events use a supplier_payment entity ID and textual PO number, without structured PO linkage/before-after totals.
- **Business impact:** A committed inventory/payment mutation can have no activity record. An audit export cannot reliably reconstruct complete changes, receipt batches or payment corrections from activity_log alone.
- **Recommended fix (not implemented):** Write immutable audit/outbox rows with the business transaction using structured PO, receipt/payment, item/product, actor, timestamp and before/after metadata; use a durable outbox for external notifications.
- **Verification:** Force audit insertion failure in a disposable environment: either the whole action must roll back, or a durable transactional event must remain for retry. Reconstruct an entire PO solely from retained events and reconcile it to stock/payment ledgers.


| Requested conceptual event | Actual implementation | Metadata/retention assessment |
|---|---|---|
| PO_CREATED | purchase_order.created — [server/controllers/purchaseOrdersController.js:330](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:330>) | PO ID, authenticated actor, log timestamp; no item/totals snapshot. |
| PO_CONFIRMED | purchase_order.confirmed — [server/controllers/purchaseOrdersController.js:506](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:506>) | PO ID/actor/timestamp; confirmed_at also stored on PO; no confirmation snapshot. |
| PO_UPDATED | purchase_order.updated — [server/controllers/purchaseOrdersController.js:428](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:428>) | PO ID/actor/timestamp; no old/new fields populated. |
| PO_CANCELLED | purchase_order.cancelled — [server/controllers/purchaseOrdersController.js:468](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:468>) | Draft is deleted; log keeps PO ID and number, not retained item/header data. |
| PO_ITEMS_RECEIVED | purchase_order.received — [server/controllers/purchaseOrdersController.js:532](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:532>) | PO/actor/timestamp and number of lines, not exact product/quantity changes or receipt ID. Stock movements contain richer line data separately. |
| PO_PARTIALLY_RECEIVED | No separate activity action | Same received event; PO status becomes partially_received. |
| PO_FULLY_RECEIVED | No separate activity action | Same received event; PO status becomes received and received_date is set. |
| PO_PAYMENT_RECORDED | purchase_order.payment_added — [server/controllers/supplierPaymentsController.js:80](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:80>) | Entity is payment ID; actor/time and amount/method/PO number in notes, not structured PO/payment deltas. |
| PO_PAYMENT_REVERSED | purchase_order.payment_deleted — [server/controllers/supplierPaymentsController.js:164](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:164>) | Correct reversing actor in activity_log, but underlying payment deleted and treasury/journal actor wrong (F12). |
| PO attachment | purchase_order.attachment_uploaded — [server/controllers/purchaseOrdersController.js:636](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:636>) | Filename in notes; best-effort like other events. |
| Cost changed on receipt | product.cost_updated — [server/controllers/purchaseOrdersController.js:578](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:578>) | Uses entity_type product_variant; product history reader expects variant ([server/controllers/productsController.js:573](<D:/Projects/mahali-light/server/controllers/productsController.js:573>)), so this event can be absent from that history view. |
| Supplier return | supplier_return.created / supplier_return.resolved — [server/controllers/supplierReturnsController.js:257](<D:/Projects/mahali-light/server/controllers/supplierReturnsController.js:257>), [server/controllers/supplierReturnsController.js:323](<D:/Projects/mahali-light/server/controllers/supplierReturnsController.js:323>) | Separate entities; labels do not establish complete financial settlement (F15). |

Cost-change history filtering mismatch is **MEDIUM, CONFIRMED**: the writer and reader entity names differ. Impact: an auditor using product history may miss receipt-triggered cost changes even when activity insertion succeeded. Recommend one entity-type contract and migration-compatible reading; verify a receipt that changes cost appears on the product history page with old/new cost and actor.

TIMESTAMPTZ allows chronological comparison, but NOW() is transaction-start time, clock_timestamp() is statement wall time, and activity insertion occurs after commit. Concurrent actions therefore cannot be causally ordered from timestamps alone. Payment lists sort business date then created_at, so a backdated payment can appear before an older-recorded payment; no stable tie-breaker is present ([server/controllers/supplierPaymentsController.js:51](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:51>)). Recommend per-entity revision/sequence and deterministic (timestamp, ID) ordering for audit views; **LOW, CODE-SUPPORTED RISK**, verify simultaneous/backdated events in a sandbox.

No append-only trigger/retention enforcement was found for these records in the inspected migrations. Database grants/production retention procedures were not inspected. Therefore “immutable audit history” is **NOT VERIFIED**, and application deletion of draft POs/payments is positively established.

## 11. User Attribution and Timestamps

| Operation | Authoritative actor storage | Time storage |
|---|---|---|
| Create PO | purchase_orders.employee_id → users.id, bound from req.user.id ([server/controllers/purchaseOrdersController.js:296](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:296>)) | created_at TIMESTAMPTZ default NOW; order_date is business DATE |
| Confirm | activity_log.performed_by; no confirmed_by column on PO ([server/controllers/purchaseOrdersController.js:506](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:506>)) | confirmed_at = NOW; old rows may be null |
| Receive | stock_movements.employee_id and product_cost_history.employee_id → users.id; controller injects actor ([server/controllers/purchaseOrdersController.js:526](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:526>)) | movement clock_timestamp(), cost-history created_at default NOW; full PO received_date DATE |
| Record payment | supplier_payments.employee_id → users.id ([server/controllers/supplierPaymentsController.js:77](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:77>)) | created_at TIMESTAMPTZ and separate payment_date DATE |
| Reverse payment | activity_log current actor; journal/treasury incorrectly original payer (F12) | new reversal journal/treasury timestamps; original payment record removed |
| Edit/cancel | activity_log.performed_by only | best-effort log timestamp; update timestamp not a full revision history |

**Soft deletion:** employee/user deletion flows inspected set is_active=false and preserve rows; user deletion also revokes sessions. PO/payment/movement user joins do not filter out inactive users. Thus retained user IDs and current usernames remain resolvable after normal soft deletion. [server/controllers/employeesController.js:185](<D:/Projects/mahali-light/server/controllers/employeesController.js:185>), [server/controllers/usersController.js:285](<D:/Projects/mahali-light/server/controllers/usersController.js:285>), [server/controllers/purchaseOrdersController.js:118](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:118>), [server/controllers/supplierPaymentsController.js:42](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:42>), [server/controllers/stockMovementsController.js:49](<D:/Projects/mahali-light/server/controllers/stockMovementsController.js:49>). This is code-supported, not an executed live soft-delete test.

**Historical identity limitation — severity MEDIUM, confidence CONFIRMED:** actor FKs use ON DELETE SET NULL ([server/db/migrations/004_suppliers.sql:23](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:23>), [server/db/migrations/004_suppliers.sql:62](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:62>), [server/db/migrations/003_stock.sql:16](<D:/Projects/mahali-light/server/db/migrations/003_stock.sql:16>)), and displays join the current username instead of storing an event-time identity snapshot. A later hard deletion loses the actor reference; a renamed username changes historical display. Employee real-name snapshots are not saved on these events. Business impact: long-term attribution can become ambiguous outside the normal soft-delete path. Recommended fix: restrict hard deletion of referenced users, retain a stable immutable identity and controlled event-time display snapshot. Verify soft deletion, username/employee-name change and attempted hard deletion in a disposable DB; all remain **NOT TESTED** against PostgreSQL.

No client can choose another receiver/payer through the inspected controller fields: actor comes from authenticated req.user, and unknown payload actor fields are not used (I16/I28). Route authorization requires appropriate permissions. This is not a full authentication penetration test; unauthorized real API requests were not sent. The shared PO-create permission also authorizes receiving, so separate receiving approval is not modeled ([server/routes/purchaseOrders.js:22](<D:/Projects/mahali-light/server/routes/purchaseOrders.js:22>)).

Timezones are handled more carefully in storage than display: database TIMESTAMPTZ preserves instants and the store timezone is configured, but payment UI uses browser-local toLocaleDateString on a DATE value and does not display recording time ([web/components/ui/PaymentHistoryTable.tsx:30](<D:/Projects/mahali-light/web/components/ui/PaymentHistoryTable.tsx:30>)). **MEDIUM, CODE-SUPPORTED RISK:** terminals with a different timezone may show a shifted calendar date when a date-only string is parsed as an instant. Recommend explicit store-zone instant formatting and date-only formatting without timezone conversion; verify Dubai and negative-offset clients at midnight without changing production terminals.

## 12. UI and API Data Consistency

Classification: **A** = data/model field absent; **B** = stored but not returned by the PO/payment API in question; **C** = returned but not displayed in this PO UI; **D** = displayed by inspected code. D is a code mapping, not an executed browser PASS.

| Required information | Class | Evidence and assessment |
|---|---|---|
| PO creator stable ID/current username | C | Saved; shapePO returns employeeId/employeeUsername ([server/controllers/purchaseOrdersController.js:59](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:59>)); detail header omits creator ([web/app/(dashboard)/purchase-orders/[id]/page.tsx:199](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:199>)). |
| Creation date/time | C | createdAt returned ([server/controllers/purchaseOrdersController.js:76](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:76>)); header shows orderDate, not createdAt/time ([web/app/(dashboard)/purchase-orders/[id]/page.tsx:212](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:212>)). |
| Confirmation time | C | confirmedAt returned ([server/controllers/purchaseOrdersController.js:68](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:68>)); detail UI does not render it. |
| True ordered-at instant | A | Only order_date DATE exists; cannot infer actual order-confirmation instant from it. |
| Supplier/PO number | D | Header renders both ([web/app/(dashboard)/purchase-orders/[id]/page.tsx:199](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:199>)). |
| Ordered/received quantities | D | POItemsTable renders ordered and received/progress ([web/components/ui/POItemsTable.tsx:66](<D:/Projects/mahali-light/web/components/ui/POItemsTable.tsx:66>), [web/components/ui/POItemsTable.tsx:90](<D:/Projects/mahali-light/web/components/ui/POItemsTable.tsx:90>)). |
| Remaining quantity | C in item table; D in receiving dialog | API returns remainingQuantity ([server/controllers/purchaseOrdersController.js:104](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:104>)); dialog computes/shows remaining ([web/components/purchases/ReceiveItemsSlideOver.tsx:39](<D:/Projects/mahali-light/web/components/purchases/ReceiveItemsSlideOver.tsx:39>)). |
| Receiving history: actor/time/quantity | B for PO detail; A for grouped receipt model | Movements/cost history store line facts, but getOne returns header/items only ([server/controllers/purchaseOrdersController.js:232](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:232>)). No receipt batch/receipt-line or PO-item ID on movements; no receiving timeline in the page. |
| Full-receipt date | C conditionally | API returns receivedDate; page renders it only inside expectedDate block, so absent expected date hides it ([web/app/(dashboard)/purchase-orders/[id]/page.tsx:300](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:300>)). |
| Payment amount/method/business date/username | D | PaymentHistoryTable renders these ([web/components/ui/PaymentHistoryTable.tsx:30](<D:/Projects/mahali-light/web/components/ui/PaymentHistoryTable.tsx:30>), [web/components/ui/PaymentHistoryTable.tsx:66](<D:/Projects/mahali-light/web/components/ui/PaymentHistoryTable.tsx:66>)). |
| Payment recording timestamp/time | C | createdAt returned ([server/controllers/supplierPaymentsController.js:38](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:38>)); table renders only paymentDate without time. |
| Payment actor ID | C | employeeId returned ([server/controllers/supplierPaymentsController.js:34](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:34>)); current username displayed; no event-time identity snapshot. |
| Payment reference | A structured field; C notes | No dedicated reference/cheque number column. UI collects free-text notes but history omits notes ([web/components/purchases/AddPaymentSlideOver.tsx:226](<D:/Projects/mahali-light/web/components/purchases/AddPaymentSlideOver.tsx:226>), [server/controllers/supplierPaymentsController.js:37](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:37>)). |
| Actual bank account | A when default-resolved; C when explicit | API has bankAccountId, but default resolution is not saved (F09), and table omits the account. |
| Paid/balance/status | D with permission caveat | Detail renders returned header totals ([web/app/(dashboard)/purchase-orders/[id]/page.tsx:282](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:282>)). Without product.view_cost, API masks totals and sets paid/balance null ([server/controllers/purchaseOrdersController.js:81](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:81>)); page hides payment history behind canSeeCost ([web/app/(dashboard)/purchase-orders/[id]/page.tsx:354](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:354>)). Supplier payment permission does not independently guarantee this visibility. |
| PO audit timeline | B, with absent metadata A | activity_log rows exist separately, but detail API/page do not return/render a PO timeline. |
| Reversed payment history | A after deletion | Original supplier_payments row is removed (F12); other logs/journal may survive. |
| Receipt warehouse | A | No location dimensions in this workflow. |
| FIFO layer/consumption link | A | No FIFO model/path discovered (F07). |

**F17 — Incomplete PO history presentation. Severity MEDIUM; confidence CONFIRMED.** Evidence is the field-by-field mapping above, especially [server/controllers/purchaseOrdersController.js:232](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:232>), [server/controllers/supplierPaymentsController.js:23](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:23>), [web/app/(dashboard)/purchase-orders/[id]/page.tsx:199](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:199>) and [web/components/ui/PaymentHistoryTable.tsx:30](<D:/Projects/mahali-light/web/components/ui/PaymentHistoryTable.tsx:30>). Impact: managers cannot identify the creator or review each receipt with employee/date/time from the PO detail view, despite some data existing elsewhere. Recommendation: add a grouped receipt model and read API, expose an auditable timeline, and render existing actor/recording timestamps with explicit permission and timezone handling. Verification: use two employees and two partial receipts/payments in an isolated UI; compare every displayed entry with exact DB IDs and amounts. Browser validation **NOT TESTED**.

Header and payment history are fetched separately and getOne fetches header/items in separate queries ([web/app/(dashboard)/purchase-orders/[id]/page.tsx:72](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:72>), [server/controllers/purchaseOrdersController.js:232](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:232>)). **MEDIUM, CODE-SUPPORTED RISK:** a concurrent receipt/payment can produce a mixed-version page even though each write is atomic. Detail requests also lack a response-generation guard, allowing a late older request to replace newer state. Recommend a consistent snapshot or revisioned aggregate response and ignore stale responses; verify delayed/out-of-order reads during concurrent sandbox writes.

## 13. Multi-Terminal Synchronization

Receiving emits stock_updated with affected variant IDs after commit, and po_received to Manager/Admin rooms. Payment addition emits po_payment_added to those rooms. The detail page listens for matching PO events and reloads. StockLevelsTab listens to stock events and reloads rows. These are genuine push/refetch paths in source, not proof of observed delivery. [server/controllers/purchaseOrdersController.js:543](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:543>), [server/controllers/purchaseOrdersController.js:561](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:561>), [server/controllers/supplierPaymentsController.js:101](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:101>), [web/store/socketStore.ts:204](<D:/Projects/mahali-light/web/store/socketStore.ts:204>), [web/app/(dashboard)/purchase-orders/[id]/page.tsx:94](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:94>), [web/components/inventory/StockLevelsTab.tsx:130](<D:/Projects/mahali-light/web/components/inventory/StockLevelsTab.tsx:130>).

### F18 — PO live synchronization misses transitions and recovery paths

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** The event bus handles po_created, po_received and po_payment_added ([web/store/socketStore.ts:204](<D:/Projects/mahali-light/web/store/socketStore.ts:204>)), while update/confirm/delete do not emit a corresponding PO event ([server/controllers/purchaseOrdersController.js:428](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:428>), [server/controllers/purchaseOrdersController.js:506](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:506>), [server/controllers/purchaseOrdersController.js:468](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:468>)). Payment reversal emits treasury updates but no PO-payment reversal event ([server/controllers/supplierPaymentsController.js:172](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:172>)). PO events target named Manager/Admin roles, not all holders of supplier/PO permissions ([server/controllers/supplierPaymentsController.js:101](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:101>)). Reconnect performs stock-cache synchronization, but no PO snapshot; its UI reconnect notification is guarded by wasConnected even though disconnect sets it false ([web/store/socketStore.ts:107](<D:/Projects/mahali-light/web/store/socketStore.ts:107>)).
- **Business impact:** PC-C can continue showing old PO state/balance after PC-B confirms, edits, deletes or reverses payment. A custom authorized role can miss even supported events; disconnected clients can miss updates indefinitely until navigation/manual reload.
- **Recommended fix (not implemented):** Publish every relevant PO revision to authorized subscribers and reconcile current revisions on reconnect/focus. Use durable outbox delivery or periodic version checks rather than relying solely on ephemeral events.
- **Verification:** With Manager, Admin and a custom authorized role on isolated browsers, perform every transition, disconnect/reconnect one observer and verify authoritative snapshot convergence. Measure commit-to-render latency there; no latency was measured here.


### F19 — Event-driven refetches can use initial filters and product views miss stock/cost events

- **Severity:** MEDIUM. **Confidence:** CONFIRMED.
- **Evidence:** PO list subscription has empty effect dependencies and captures the initial fetchData/filter state ([web/app/(dashboard)/purchase-orders/page.tsx:99](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/page.tsx:99>), [web/app/(dashboard)/purchase-orders/page.tsx:140](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/page.tsx:140>)). StockLevelsTab has the same empty-dependency capture ([web/components/inventory/StockLevelsTab.tsx:125](<D:/Projects/mahali-light/web/components/inventory/StockLevelsTab.tsx:125>)). Product list/detail subscribe to product events ([web/app/(dashboard)/products/page.tsx:160](<D:/Projects/mahali-light/web/app/(dashboard)/products/page.tsx:160>), [web/app/(dashboard)/products/[id]/page.tsx:130](<D:/Projects/mahali-light/web/app/(dashboard)/products/[id]/page.tsx:130>)), whereas receiving emits stock_updated. Stock-cache bulk updates start fullSync, whose clear/refill and catch behavior can leave partial or overlapping snapshots ([web/services/stockCacheService.ts:42](<D:/Projects/mahali-light/web/services/stockCacheService.ts:42>), [web/services/stockCacheService.ts:107](<D:/Projects/mahali-light/web/services/stockCacheService.ts:107>)).
- **Business impact:** After changing filters/page, a remote event can repopulate initial-query data while controls still show current filters. Product quantity/cost views may stay stale, and reconnect cache completion is not an ordered revision guarantee.
- **Recommended fix (not implemented):** Subscribe using current state/ref-safe callbacks, invalidate all affected product/PO queries, and apply versioned atomic cache snapshots with failure recovery.
- **Verification:** Change page/filter on PC-C, receive/pay from PC-B, and delay/reorder fetch responses in an isolated browser. Assert visible rows match current filters and all quantity/cost displays converge. Browser/cache timing tests remain NOT TESTED.


**Performance scope:** receiving issues queries proportional to item count and holds the PO and touched variants until cost/ledger work completes. Multiple terminals receiving/selling the same SKU serialize at that variant; cash/bank account balance locks can also serialize payments. The database pool maximum is 10, and bulk stock events can trigger full paginated cache refreshes rather than delta updates ([server/db/postgres.js:8](<D:/Projects/mahali-light/server/db/postgres.js:8>), [server/services/purchaseOrderService.js:126](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:126>), [web/services/stockCacheService.ts:107](<D:/Projects/mahali-light/web/services/stockCacheService.ts:107>)). These are bottleneck candidates, not measured capacity limits. For 5/10/20/50 terminals, throughput, lock waits, event fan-out, reconnect storms and p95 latency are **NOT TESTED**; no production load test was performed. Recommend scoped deltas/versioning and sandbox load/lock profiling after correctness defects are fixed.

## 14. Database Integrity

| Integrity area | Implemented | Limitation |
|---|---|---|
| PO identity | UUID PK, unique PO number, transactional document counter | No caller operation uniqueness for create/retry |
| Header/items | PO FK with cascade, product/variant independent FKs | Ownership pair not enforced; deletion erases draft lines |
| Quantities | NUMERIC(12,2), backend positive/remaining checks | No CHECK for positive ordered quantity, nonnegative received or received <= ordered; scale differs from service |
| Money | NUMERIC(12,2), backend rounding/balance check, journal-line debit/credit CHECK | No database-enforced PO total/paid/balance consistency or payment positivity |
| Status | Varchar defaults, service guards | No enum/check transition constraint; different write paths have different guards |
| Payments | PO/supplier FKs restrict deletion | Supplier/PO consistency not composite-enforced; bank UUID has no FK; payment reversal deletes record |
| Receipt history | Movements and product_cost_history | No receipt header/line identity or delivery/request uniqueness |
| Movement reference | Polymorphic reference_type/id | No FK to PO or item; no unique receipt effect; product deletion may null IDs |
| Actors | User FKs, normal soft deletion retains users | Hard deletion sets FK null; no immutable identity snapshot |
| Journals | Header/line FKs, balanced posting service | Polymorphic business references can outlive deleted payment/PO |
| Atomic writes | Shared transaction client for receiving/payment/treasury/journal | Audit, events, attachments and response queries outside core transaction |
| Time | TIMESTAMPTZ events and DATE business dates | No ordered_at instant; no grouped receipt timestamp; business-date propagation defect |
| Retention | No business-history cleanup found in inspected cleanup jobs | Application deletes drafts/payments; database privileges and operational retention NOT VERIFIED |

Schema evidence: [server/db/migrations/004_suppliers.sql:19](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:19>), [server/db/migrations/004_suppliers.sql:41](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:41>), [server/db/migrations/004_suppliers.sql:54](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:54>), [server/db/migrations/004_suppliers.sql:68](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:68>), [server/db/migrations/003_stock.sql:5](<D:/Projects/mahali-light/server/db/migrations/003_stock.sql:5>), [server/db/migrations/013_finance.sql:38](<D:/Projects/mahali-light/server/db/migrations/013_finance.sql:38>). The later bank-FK migration adds constraints for other payment tables, not supplier_payments ([server/db/migrations/026_payment_bank_fks.sql:1](<D:/Projects/mahali-light/server/db/migrations/026_payment_bank_fks.sql:1>)).

**F20 — Database invariants rely too heavily on individual application paths. Severity HIGH; confidence CODE-SUPPORTED RISK.** The missing constraints above are confirmed from migrations; inconsistent direct writes/concurrent administrative changes were not attempted. Impact: a future endpoint, import or bug can create invalid product/variant links, quantities, bank references or header/payment totals even when ordinary UI validation succeeds. Recommended fix: add relational ownership/bank constraints, legal-state/positive/bounds constraints where appropriate, operation uniqueness, and controlled aggregate reconciliation with explicit handling of existing records. Verify in a disposable migrated database with invalid INSERT/UPDATE attempts and randomized valid lifecycle sequences; audit/repair planning must precede any production migration. **No schema or records were changed.**

The reviewed migrations express intended schema; the running database's migration version, constraints, data quality, timezone settings, grants, backups and existing orphan/duplicate records were not queried. A migration file is not evidence that production has applied it.

## 15. Detailed Verification Matrix

### Execution boundary and reproducibility

The 33 checks below were executed with **Node v24.15.0**. Actual source modules were loaded in a VM with an explicit dependency allowlist. The actual PostgreSQL transaction wrapper ran against a **fake pg.Pool**. SQL was interpreted by an in-memory fixture with a snapshot/rollback model. Actual PO, stock, supplier-payment and bank-service logic was exercised; journal calls were captured/stubbed rather than posting real ledger rows. Cash processing, actual database constraints/locks/timestamp generation, browser rendering and sockets were not executed.

The frontend false-success check extracted the actual new-page save function using the already-installed TypeScript parser and ran it against mocked dependencies; it did not render React or contact APIs. The schema checks used installed Zod. Synthetic dates and users were used. The model's date helper is simplified and does not test Asia/Dubai daylight/calendar boundary behavior. Numeric storage was modeled with two-decimal rounding; it is not a substitute for PostgreSQL NUMERIC semantics. Unexpected imports or unmodeled SQL aborted the harness. Check failures were captured as audit results, so process exit 0 indicates completed execution, not that all assertions passed.

**Executed result:** 17 PASS, 16 FAIL. All results are scoped to this boundary. “Severity” identifies the business risk if the invariant fails, including for positive controls; it is not a claim that a passing check is itself a defect.

| Test ID | Expected behavior / asserted invariant | Actual isolated result | Status | Exact source evidence | Severity | Recommended real verification |
|---|---|---|---|---|---|---|
| I01 | Receive example 20 + 30 + 25; PO 55 fully received | Isolated SQL model: stock 20→50→75; received 0→30→55; remaining 55→25→0. | **PASS** | [server/services/purchaseOrderService.js:93](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:93>) | HIGH | Repeat the 20/55/30/25 example in a disposable migrated DB; compare stock and item rows after each commit. |
| I02 | Each receipt issues movement with actor, PO, quantity and before/after | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/stockService.js:216](<D:/Projects/mahali-light/server/services/stockService.js:216>) | HIGH | Query both persisted movement rows, actors, PO references, timestamps and before/after quantities. |
| I03 | Over-receipt rejected and wrapper rolls back | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/purchaseOrderService.js:146](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:146>) | HIGH | Attempt remaining+1 and assert no stock/item/movement/journal changes. |
| I04 | Draft/cancelled/received/closed receipts rejected | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/purchaseOrderService.js:112](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:112>) | MEDIUM | Attempt receipts in each invalid persisted state; verify HTTP 409 and no writes. |
| I05 | HTTP receive schema rejects zero and negative quantities | Expected assertion satisfied at isolated boundary. | **PASS** | [server/controllers/purchaseOrdersController.js:44](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:44>) | HIGH | Send 0 and negative quantities through the actual isolated HTTP route. |
| I06 | Duplicate partial receive is idempotent | Same partial request applied twice: stock is 40, expected 30 for one delivery 40 !== 30 | **FAIL** | [server/services/purchaseOrderService.js:126](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:126>) | HIGH | Repeat a partial receipt with the same future operation ID; assert one business effect. |
| I07 | Duplicate line IDs within one receive are rejected/deduplicated | Repeated line ID applied twice within one operation 20 !== 10 | **FAIL** | [server/controllers/purchaseOrdersController.js:44](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:44>) | HIGH | Submit two identical item IDs in one receipt and require rejection before writes. |
| I08 | Split fractional receipts preserve net ledger value | Two half-unit receipts post 0.01 each = 0.02 against a 0.01 net PO 0.02 !== 0.01 | **FAIL** | [server/services/purchaseOrderService.js:186](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:186>) | HIGH | Persist two 0.5-unit receipts at 0.01, then reconcile net journal total to PO net. |
| I09 | Partial VAT allocation sums to PO tax | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/purchaseOrderService.js:236](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:236>) | HIGH | Post all partial receipts into real journal tables; sum tax and compare PO tax. |
| I10 | Product/variant ownership mismatch rejected | Movement records supplied product B while stock belongs to variant of product A + actual - expected + '00000000-0000-4000-8000-000000000008' - '00000000-0000-4000-8000-000000000004' ^ | **FAIL** | [server/services/stockService.js:135](<D:/Projects/mahali-light/server/services/stockService.js:135>) | HIGH | Submit mismatched valid product/variant IDs through create and receive; require rejection. |
| I11 | Payment example 57.75 minus 20 then 37.75 | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>) | HIGH | Record 20 and 37.75 against 57.75 in a sandbox; reconcile payment rows, treasury and journal. |
| I12 | Overpayment rejected using current PO balance | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/supplierPaymentService.js:75](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:75>) | HIGH | Attempt 37.76 after paying 20 against 57.75 and assert rollback. |
| I13 | Nonpositive or invalid payment methods rejected | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/supplierPaymentService.js:39](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:39>) | HIGH | Test zero, negative, amount rounding to zero and unknown method via the actual route. |
| I14 | Cancelled PO payment rejected | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/supplierPaymentService.js:63](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:63>) | MEDIUM | Attempt payment on a cancelled fixture and verify no persisted side effects. |
| I15 | Duplicate partial payment is idempotent | Same partial payment applied twice; paid total becomes 40 40 !== 20 | **FAIL** | [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>) | HIGH | Replay the same partial-payment operation ID concurrently and sequentially. |
| I16 | Receiver identity comes from authenticated request | Expected assertion satisfied at isolated boundary. | **PASS** | [server/controllers/purchaseOrdersController.js:526](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:526>) | HIGH | Authenticate user A and send forged actor B; inspect persisted movement actor A. |
| I17 | Payment stores caller actor, method, PO, and business date | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>) | HIGH | Compare authenticated actor, selected business date, method and PO with the persisted payment. |
| I18 | Reversal treasury/journal actor is the reversing user | Reversal uses original payer ID, not the manager executing reversal + actual - expected + '00000000-0000-4000-8000-000000000006' - '00000000-0000-4000-8000-000000000007' ^ | **FAIL** | [server/services/supplierPaymentService.js:241](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:241>) | HIGH | Have user B reverse user A payment; verify journal/treasury reversing actor B. |
| I19 | Reversal preserves original payment record | Payment is physically deleted; no reversed status is retained 0 !== 1 | **FAIL** | [server/services/supplierPaymentService.js:211](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:211>) | HIGH | Reverse a payment and require original record/evidence plus linked reversal to remain. |
| I20 | Resolved default bank is saved on supplier payment | Bank transaction uses bankA but supplier payment stores NULL null !== 'bankA' | **FAIL** | [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>) | HIGH | Pay without explicit bank ID; assert persisted payment ID matches actual bank transaction account. |
| I21 | Reversal returns money to original bank after default changes | Original bank stays 980; reversal credits newly default bankB to 1020 980 !== 1000 | **FAIL** | [server/services/supplierPaymentService.js:264](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:264>) | HIGH | Switch default bank between payment and same-day reversal; require original bank restoration. |
| I22 | Bank transaction business date matches payment date | Bank service receives no transactionDate and uses today, while payment/journal use selected earlier date + actual - expected + '2026-10-23' - '2026-10-20' ^ | **FAIL** | [server/services/supplierPaymentService.js:136](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:136>) | MEDIUM | Backdate a permitted bank payment; compare all three business dates. |
| I23 | Cheque marked paid has a matching settlement/accounting lifecycle | Cheque makes PO paid with no treasury or journal entry; no pending state passed | **FAIL** | [server/services/supplierPaymentService.js:151](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:151>) | HIGH | Exercise issued/cleared/bounced cheque states and reconcile AP/clearing/bank. |
| I24 | Audit failure prevents silent success | Audit writer resolves after failed INSERT; business action can succeed without audit | **FAIL** | [server/utils/activityLog.js:12](<D:/Projects/mahali-light/server/utils/activityLog.js:12>) | HIGH | Inject audit failure during a sandbox action and require rollback or a durable transactional outbox record. |
| I25 | Journal failure triggers real wrapper ROLLBACK and release | Actual withTransaction emitted ROLLBACK/release; data restoration is the fake SQL model, not real PostgreSQL evidence. | **PASS** | [server/db/postgres.js:52](<D:/Projects/mahali-light/server/db/postgres.js:52>) | HIGH | Cause a real journal constraint/period failure; prove real DB stock/item/cost/movement changes all roll back. |
| I26 | Wizard does not announce payment success after payment failure | Wizard warns payment failed then announces confirmed and payment recorded | **FAIL** | [web/app/(dashboard)/purchase-orders/new/page.tsx:251](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:251>) | HIGH | Fail payment in an isolated browser and assert no payment-success message or duplicate create on retry. |
| I27 | Server calculates VAT from settings | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/purchaseOrderService.js:26](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:26>) | MEDIUM | Persist a VAT-enabled PO and compare preview/API/DB/ledger, including frontend tax/shipping input. |
| I28 | PO create binds authenticated creator and supplies database timestamp defaults | Creator parameter is authenticated user; caller timestamp omitted from INSERT; actual DB timestamp generation not executed. | **PASS** | [server/controllers/purchaseOrdersController.js:285](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:285>) | HIGH | Send forged creator/createdAt extras; query actual server-generated timestamp and authenticated creator. |
| I29 | Unsupported sub-cent quantity precision rejected at receive API | 0.004 passes positive-number schema despite DECIMAL(12,2) quantity storage true !== false | **FAIL** | [server/controllers/purchaseOrdersController.js:44](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:44>) | HIGH | Test sub-scale quantities against real NUMERIC columns and assert consistent validation/storage. |
| I30 | Paid draft cannot be edited below amount paid | Draft accepted payment; recalculation reduces gross to 10.50, leaves paid 20 and balance -9.50 | **FAIL** | [server/services/purchaseOrderService.js:58](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:58>) | HIGH | Pay a draft then reduce total/change supplier; require safe policy and consistent totals/subledger. |
| I31 | Latest-cost valuation reconciles to historic receipts | Latest-cost report values 50×10=500; opening 20×5 plus received 30×10 =400 500 !== 400 | **FAIL** | [server/services/purchaseOrderService.js:207](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:207>) | HIGH | Receive differently priced lots and reconcile inventory valuation to inventory-control GL. |
| I32 | Successful receive uses PO, item and variant lock SQL on one client | Lock statements and transaction plumbing executed against fake client; real lock contention/isolation NOT TESTED. | **PASS** | [server/services/stockService.js:122](<D:/Projects/mahali-light/server/services/stockService.js:122>) | HIGH | Run competing transactions on same/different POs and same variants; inspect lock waits and final balances. |
| I33 | Sequential full-payment duplicate rejected after balance exhausted | Expected assertion satisfied at isolated boundary. | **PASS** | [server/services/supplierPaymentService.js:75](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:75>) | HIGH | Retry a fully applied payment after a lost response; require recoverable original result, not an ambiguous duplicate error. |

### Required verification not executed against real systems

The following rows deliberately remain **NOT TESTED**. Source-supported expectations and isolated failures are not promoted to production PASS/FAIL. Procedures require a separately authorized disposable application/database/browser environment; do not run them on the LAN production server.

| Test ID | Expected behavior | Actual behavior verified here | Status | Exact evidence for planned check | Severity | Recommended verification procedure |
|---|---|---|---|---|---|---|
| N01 — PO creation persistence | Header/items/creator/time/totals persist together | Source and I28 only; actual DB defaults/FKs not executed | NOT TESTED | [server/controllers/purchaseOrdersController.js:285](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:285>), [server/db/migrations/004_suppliers.sql:19](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:19>) | HIGH | Create a sandbox PO; query every header/item and force an item failure to verify no partial header. |
| N02 — Durable partial/full receipt | Example 20→50→75, received 30→55, complete movement/journal chain | I01/I02 model only | NOT TESTED | [server/services/purchaseOrderService.js:93](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:93>), [server/services/stockService.js:196](<D:/Projects/mahali-light/server/services/stockService.js:196>) | HIGH | Execute both receives through isolated HTTP; restart only that disposable DB afterward and verify persistence. |
| N03 — Concurrent same-PO receiving | Sum of genuine deliveries, no over-receipt, duplicate operation once | Row-lock SQL observed; no competing DB clients | NOT TESTED | [server/services/purchaseOrderService.js:105](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:105>), [server/services/purchaseOrderService.js:146](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:146>) | HIGH | Barrier-synchronize two DB-backed receive requests for same item and assert final stock/items/movements. |
| N04 — Cross-PO same-variant receiving | No lost updates | Variant lock in source only | NOT TESTED | [server/services/stockService.js:122](<D:/Projects/mahali-light/server/services/stockService.js:122>) | HIGH | Receive two POs simultaneously for same variant; compare sum of all deltas to final stock. |
| N05 — Deadlock and concurrent sale | Atomic rollback/retry, no inconsistent stock | Opposite lock order is a code-supported risk | NOT TESTED | [server/services/purchaseOrderService.js:126](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:126>), [server/services/stockService.js:122](<D:/Projects/mahali-light/server/services/stockService.js:122>) | MEDIUM | Receive A/B and B/A concurrently and run sales/returns against same variants; inspect lock errors and operation recovery. |
| N06 — Receipt retry after commit | Exactly one business receipt | I06 fails sequential model; network timing not executed | NOT TESTED | [web/services/http.ts:45](<D:/Projects/mahali-light/web/services/http.ts:45>) | HIGH | Drop the response after sandbox commit and retry original operation; inspect all dependent rows. |
| N07 — Financial partial/full payment persistence | 20 + 37.75 settles 57.75 in payment/PO/treasury/GL | I11 model only; actual ledger stubbed | NOT TESTED | [server/services/supplierPaymentService.js:51](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:51>), [server/services/journalService.js:626](<D:/Projects/mahali-light/server/services/journalService.js:626>) | HIGH | Record each method in an isolated DB and reconcile payment sum, header, AP and bank/cash. |
| N08 — Concurrent/duplicate payments | Distinct affordable payments accepted; duplicates once; overpay blocked | Sequential isolated duplicate fails, real locks not tested | NOT TESTED | [server/services/supplierPaymentService.js:53](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:53>), [server/services/supplierPaymentService.js:75](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:75>) | HIGH | Submit synchronized requests, including identical operation IDs and total above outstanding balance. |
| N09 — Real transactional rollback | No partial stock/payment/GL effects | I25 only exercised fake rollback restoration | NOT TESTED | [server/db/postgres.js:52](<D:/Projects/mahali-light/server/db/postgres.js:52>) | HIGH | Inject real DB/journal failure after stock/payment writes in a disposable database and inspect every table. |
| N10 — FIFO/cost accounting | Chosen method reconciles units, cost layers/GL and COGS | No FIFO implementation found; I31 formula mismatch reproduced | NOT TESTED | [server/services/purchaseOrderService.js:207](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:207>), [server/services/invoiceService.js:660](<D:/Projects/mahali-light/server/services/invoiceService.js:660>) | HIGH | After defining costing policy, receive/sell/return across price layers and reconcile total value. |
| N11 — Audit log durability | Every action has durable structured audit metadata | I24 fails isolated error propagation; no real audit row inserted | NOT TESTED | [server/utils/activityLog.js:12](<D:/Projects/mahali-light/server/utils/activityLog.js:12>) | HIGH | Verify transactional persistence and simulate audit-store failure in disposable DB. |
| N12 — User soft deletion | Historical PO/receipt/payment actors remain identifiable | Source indicates retained user rows and joins | NOT TESTED | [server/controllers/usersController.js:285](<D:/Projects/mahali-light/server/controllers/usersController.js:285>), [server/controllers/supplierPaymentsController.js:42](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:42>) | MEDIUM | Create history for synthetic user, soft-delete/rename it, then inspect API/UI and retained IDs. |
| N13 — Date/time preservation | Server instant retained; business dates consistent in store zone | Defaults/formatting source reviewed; I22 mismatch reproduced | NOT TESTED | [server/db/migrations/004_suppliers.sql:37](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:37>), [server/db/migrations/004_suppliers.sql:61](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:61>), [server/utils/dates.js:18](<D:/Projects/mahali-light/server/utils/dates.js:18>) | MEDIUM | Test midnight boundaries, backdating and browser zones against actual timestamp/date values. |
| N14 — Multi-terminal synchronization | Receive/pay/confirm/reverse updates all authorized viewers | Push paths and gaps found; no browsers connected | NOT TESTED | [web/store/socketStore.ts:204](<D:/Projects/mahali-light/web/store/socketStore.ts:204>), [server/controllers/supplierPaymentsController.js:172](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:172>) | MEDIUM | Use at least two isolated clients; measure commit-to-render latency for each transition and role. |
| N15 — Reconnect and stale responses | Reconnected viewer converges; older response cannot overwrite newer | Reconnect/refetch gaps identified in source | NOT TESTED | [web/store/socketStore.ts:107](<D:/Projects/mahali-light/web/store/socketStore.ts:107>), [web/app/(dashboard)/purchase-orders/[id]/page.tsx:72](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/[id]/page.tsx:72>) | MEDIUM | Disconnect observer, mutate elsewhere, reconnect; delay responses and verify latest revision and filters. |
| N16 — Database constraints/deployment | Running schema matches migrations; no invalid links/totals | No database introspection authorized/executed | NOT TESTED | [server/db/migrations/004_suppliers.sql:19](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:19>), [server/db/migrations/026_payment_bank_fks.sql:1](<D:/Projects/mahali-light/server/db/migrations/026_payment_bank_fks.sql:1>) | HIGH | Read-only catalog/data checks in an explicitly authorized database; invalid-write tests only on a disposable clone. |
| N17 — Actual supplier-return UI | Stock, VAT, inventory GL, supplier credit/refund and PO balance reconcile | Two divergent source flows; no UI/DB request | NOT TESTED | [server/controllers/supplierReturnsController.js:179](<D:/Projects/mahali-light/server/controllers/supplierReturnsController.js:179>), [server/services/returnService.js:1001](<D:/Projects/mahali-light/server/services/returnService.js:1001>) | HIGH | Exercise PO-button return for paid/unpaid and partial/full receipts, including every resolution. |
| N18 — 5/10/20/50 terminals | Correct totals under load; bounded latency/lock waits/cache work | No load test or latency measurements | NOT TESTED | [server/db/postgres.js:8](<D:/Projects/mahali-light/server/db/postgres.js:8>), [web/services/stockCacheService.ts:107](<D:/Projects/mahali-light/web/services/stockCacheService.ts:107>) | MEDIUM | After correctness fixes, generate isolated terminal workloads and report p50/p95/p99, lock waits, errors and reconciliations. |
| N19 — UI permission and identity | Authorized roles see required history; unauthorized writes rejected | Guards and payload bindings inspected only | NOT TESTED | [server/routes/purchaseOrders.js:10](<D:/Projects/mahali-light/server/routes/purchaseOrders.js:10>), [server/routes/supplierPayments.js:10](<D:/Projects/mahali-light/server/routes/supplierPayments.js:10>) | HIGH | Test read/write roles, custom roles and forged actor/product IDs with synthetic users. |
| N20 — Cancellation/correction retention | Retained cancelled/reversed records reconstruct history | Deletion confirmed in source and I19 model | NOT TESTED | [server/controllers/purchaseOrdersController.js:460](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:460>), [server/services/supplierPaymentService.js:211](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:211>) | HIGH | Cancel/reverse in disposable DB, export complete audit trail, and verify retained attachments and original identities. |

### Existing tests inspected, not executed

- [tests/integration/purchaseOrders.test.js:34](<D:/Projects/mahali-light/tests/integration/purchaseOrders.test.js:34>) is environment-gated, creates/migrates/seeds a test database and drops it afterward. It covers creation, notes update, confirmation and restrictions on confirmed edits/deletion; it does not establish receiving/payment concurrency or idempotency.
- [tests/integration/purchaseVat.test.js:20](<D:/Projects/mahali-light/tests/integration/purchaseVat.test.js:20>) also creates a test database; it covers partial VAT, payment/journal behavior, rounding, reporting and the **separate generic approved-return service**, not the PO supplier-return button path. [tests/integration/purchaseVat.test.js:140](<D:/Projects/mahali-light/tests/integration/purchaseVat.test.js:140>), [tests/integration/purchaseVat.test.js:167](<D:/Projects/mahali-light/tests/integration/purchaseVat.test.js:167>).
- [tests/unit/stockService.test.js:74](<D:/Projects/mahali-light/tests/unit/stockService.test.js:74>) contains mocked stock validation/sign/insufficient-stock tests. They were read, not run.
- These suites were not run because no disposable PostgreSQL target was established and their setup performs database creation/migration/seed/drop. No existing test is reported PASS from inspection alone.

## 16. Prioritized Recommendations

All recommendations are proposals only; **none were implemented**.

| Priority | Work | Acceptance gate |
|---|---|---|
| P0 | Add persistent idempotency for PO creation, receiving and payments; reject duplicate receipt line IDs (F01) | Lost-response and concurrent retry tests produce one business effect. |
| P0 | Persist resolved bank account and implement retained, correctly attributed payment reversals (F09/F12) | Default-bank changes cannot redirect reversals; original and reversal history reconcile. |
| P0 | Correct cheque and actual PO supplier-return accounting (F10/F15) | PO, supplier subledger, inventory/AP/VAT and treasury reconcile for all supported methods/resolutions. |
| P0 | Enforce product/variant ownership and supported quantity precision (F02/F06) | Invalid pairs/scales fail before writes; quantity ledgers reconcile exactly. |
| P0 | Correct fractional receipt net rounding and define consistent costing/valuation (F07/F08) | Cumulative receipt values equal PO values; stock valuation reconciles to inventory GL/COGS. |
| P0 | Prevent paid-draft financial/supplier drift and false wizard success (F13/F16) | Amendments follow explicit policy; failed payment is never shown successful. |
| P1 | Make audit persistence transactional and add immutable receipt/payment-reversal entities (F11/F12/F17) | Every operation has actor, timestamp, line quantities/amounts and stable before/after linkage. |
| P1 | Add database invariants and migration/reconciliation plan (F20) | Disposable invalid-write tests fail; valid sequences reconcile; existing data evaluated read-only first. |
| P1 | Correct backdated treasury dates, cancellation retention and partial-update semantics (F04/F05/F14) | Historical records remain complete; omitted PATCH fields survive; all business dates agree. |
| P1 | Complete authorized realtime events, reconnect snapshots, current-filter refetch and response ordering (F18/F19) | All supported transitions converge across roles/terminals and network interruptions. |
| P2 | Expose creator, recording times, receipt timeline, notes/account references and retained identity | API/UI field mapping has no unexplained A/B/C gaps for required audit fields. |
| P2 | Clarify warehouse, prepayment, cheque clearing, correction and quantity-unit policies | Scope and accounting behavior documented and tested before enabling those workflows. |
| P2 | Run isolated 5/10/20/50-terminal profiling after correctness changes | No invariant failures; agreed latency/lock-wait/error budgets satisfied. |

## 17. Production Readiness Verdict

**NO — the full PO lifecycle should not receive production-readiness approval in its current audited state.** This is a conclusion about the inspected implementation and reproduced isolated failures, not a claim that production data is already corrupted. The core normal receiving/payment path is present and has useful transaction/locking safeguards, but inventory identity, idempotency, valuation, payment reversal, supplier-return accounting and durable audit history have material gaps.

### Direct answers to all 20 required questions

“YES” below describes the verified code contract and, where stated, an isolated result. It never means a live deployment was tested.

| Question | Direct answer | Supporting evidence and limits |
|---|---|---|
| Q1. Does receiving items actually increase inventory? | **YES** | Actual service adds to product_variants.stock_qty; I01 produced 20→50→75. [server/services/stockService.js:172](<D:/Projects/mahali-light/server/services/stockService.js:172>), [server/services/stockService.js:196](<D:/Projects/mahali-light/server/services/stockService.js:196>). Real DB persistence NOT TESTED. |
| Q2. Does inventory increase by the correct received quantity? | **PARTIAL** | Ordinary supported quantities pass I01; duplicates and unsupported precision threaten correctness (I06/I07/I29, F01/F06). |
| Q3. Is receiving atomic and concurrency-safe? | **PARTIAL** | Core stock/items/cost/status/journal share a transaction and row locks ([server/services/purchaseOrderService.js:102](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:102>), [server/services/stockService.js:122](<D:/Projects/mahali-light/server/services/stockService.js:122>)); no idempotency, audit outside transaction, real contention NOT TESTED. |
| Q4. Who created the PO, and is their user ID saved? | **YES** | Authenticated req.user.id is saved in purchase_orders.employee_id → users.id; current username joined by API. [server/controllers/purchaseOrdersController.js:296](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:296>), [server/db/migrations/004_suppliers.sql:23](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:23>). |
| Q5. Is PO creation date and time saved? | **YES** | created_at TIMESTAMPTZ default NOW. order_date DATE and confirmed_at are separate. [server/db/migrations/004_suppliers.sql:37](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:37>), [server/db/migrations/035_po_confirmed_at.sql:11](<D:/Projects/mahali-light/server/db/migrations/035_po_confirmed_at.sql:11>). |
| Q6. Who received each product, and is their user ID saved? | **YES** | Authenticated receiver stored on each stock movement/cost history row. [server/controllers/purchaseOrdersController.js:526](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:526>), [server/services/stockService.js:216](<D:/Projects/mahali-light/server/services/stockService.js:216>), [server/services/purchaseOrderService.js:189](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:189>). No dedicated receipt header actor. |
| Q7. Is exact received quantity saved for each receiving event? | **PARTIAL** | Per-line quantities exist in stock movements and cost history; cumulative received exists on PO item. No grouped receipt/PO-item linkage, and two-decimal storage cannot retain arbitrary accepted precision. [server/db/migrations/004_suppliers.sql:50](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:50>), [server/db/migrations/003_stock.sql:10](<D:/Projects/mahali-light/server/db/migrations/003_stock.sql:10>). |
| Q8. Is receiving date and time saved? | **YES** | Each movement uses clock_timestamp(); cost history has created_at. Full PO received_date is date-only and not a partial-receipt timeline. [server/services/stockService.js:220](<D:/Projects/mahali-light/server/services/stockService.js:220>), [server/db/migrations/004_suppliers.sql:78](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:78>). |
| Q9. Does every receipt create an inventory movement record? | **YES** | Each accepted positive receipt line calls the stock engine, which inserts a movement in the shared transaction; I02 verifies issued records in the model. [server/services/purchaseOrderService.js:165](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:165>), [server/services/stockService.js:216](<D:/Projects/mahali-light/server/services/stockService.js:216>). Live persistence NOT TESTED. |
| Q10. Are FIFO inventory costs handled correctly? | **NO** | No FIFO layer/consumption model found; receiving overwrites current cost and valuation uses that cost (F07). [server/services/purchaseOrderService.js:207](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:207>). |
| Q11. Does Add Payment persist the correct amount? | **PARTIAL** | Two-decimal positive amount is inserted; ordinary example passes I11. Duplicate submissions, cheque settlement gaps and destructive correction prevent a complete guarantee. [server/services/supplierPaymentService.js:83](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:83>). |
| Q12. Who recorded the payment, and is their user ID saved? | **YES** | Authenticated recorder saved in supplier_payments.employee_id. [server/controllers/supplierPaymentsController.js:77](<D:/Projects/mahali-light/server/controllers/supplierPaymentsController.js:77>), [server/db/migrations/004_suppliers.sql:62](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:62>). Reversal accounting actor is incorrect (F12). |
| Q13. Is payment date and time saved? | **YES** | payment_date is selected business DATE, created_at authoritative recording TIMESTAMPTZ. No separate actual settlement instant; bank business-date mismatch exists (F14). [server/db/migrations/004_suppliers.sql:61](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:61>), [server/db/migrations/004_suppliers.sql:65](<D:/Projects/mahali-light/server/db/migrations/004_suppliers.sql:65>). |
| Q14. Are partial payments and balances calculated correctly? | **PARTIAL** | 57.75−20−37.75 passes I11 and overpayment is checked under lock; paid-draft edits, duplicates, cheque and return handling can break financial consistency. [server/services/supplierPaymentService.js:103](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:103>), [server/services/purchaseOrderService.js:58](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:58>). |
| Q15. Can duplicate or concurrent requests corrupt inventory/payment totals? | **YES** | Identical partial requests are accepted twice while allowance remains (I06/I15). Locks address lost updates but not duplicate intent; real concurrent execution remains NOT TESTED. |
| Q16. Are all operations recorded in the audit log? | **NO** | Audit insert errors are swallowed after business commit; metadata and event coverage are incomplete (F11/I24). [server/utils/activityLog.js:12](<D:/Projects/mahali-light/server/utils/activityLog.js:12>). |
| Q17. Are records preserved when an employee is soft-deleted? | **YES** | Normal soft-delete retains employee/user rows and business references; inactive users remain joinable. [server/controllers/employeesController.js:185](<D:/Projects/mahali-light/server/controllers/employeesController.js:185>), [server/controllers/usersController.js:285](<D:/Projects/mahali-light/server/controllers/usersController.js:285>). Runtime NOT TESTED; hard deletion/renames differ. |
| Q18. Do multiple terminals see consistent information? | **PARTIAL** | Receive/payment-add push/refetch exists, but other transitions, custom-role delivery, reconnect and stale-query handling have gaps (F18/F19). Actual LAN synchronization NOT TESTED. |
| Q19. Which required fields are missing from database/API/UI? | **PARTIAL** | Some are stored but hidden: creator/createdAt/confirmedAt/payment recording time/notes. Receipt batch/line IDs, structured payment reference, immutable reversal/actor snapshot, warehouse and FIFO fields are absent; receipt/audit history is not in PO detail API/UI. Full A/B/C/D classification is in section 12. |
| Q20. Is the full PO lifecycle production-ready? | **NO** | Material reproduced and source-confirmed inventory/financial/audit defects remain. Resolve priority gates and execute isolated DB/UI/concurrency/recovery verification before sign-off. |

### Audit artifacts and source fingerprint

The only created artifact is this Markdown report. No fixes were applied. Source fingerprints below identify the actual module versions used by the isolated harness; other inspected files are referenced at their reviewed working-tree line numbers.

| Source | SHA-256 at test execution |
|---|---|
| [server/db/postgres.js:1](<D:/Projects/mahali-light/server/db/postgres.js:1>) | `cb8e66a5eea7c46dacf66a78c577e6962fd7f1a850190d5f7c2d5f0a1dc1665c` |
| [server/services/bankService.js:1](<D:/Projects/mahali-light/server/services/bankService.js:1>) | `5210cf830f1923dc1f572cb421c4fab3ffe746b5ac33a9c0796820d843d5e3da` |
| [server/services/stockService.js:1](<D:/Projects/mahali-light/server/services/stockService.js:1>) | `4ff46a180b62227c5738516837063cb5965a8330618047766a1b1a4725952ad6` |
| [server/services/purchaseOrderService.js:1](<D:/Projects/mahali-light/server/services/purchaseOrderService.js:1>) | `555016db97184c19cfa6f26a87eecd4af0946d1472e89938dd3c8e4f97323a5e` |
| [server/services/supplierPaymentService.js:1](<D:/Projects/mahali-light/server/services/supplierPaymentService.js:1>) | `ca913c33e0a9b7a6905cd96069f9d8916bbdf5915f48a43caba67ef8bbc56ce5` |
| [server/controllers/purchaseOrdersController.js:1](<D:/Projects/mahali-light/server/controllers/purchaseOrdersController.js:1>) | `01785eeaa850c97045172a02bfd72d93eee2270f3ae4ff865e285c3411a81b11` |
| [server/utils/activityLog.js:1](<D:/Projects/mahali-light/server/utils/activityLog.js:1>) | `728963df606236d4ef2813b6afb0694d7c33b147679245b9930fcf0a52c95644` |
| [web/app/(dashboard)/purchase-orders/new/page.tsx:1](<D:/Projects/mahali-light/web/app/(dashboard)/purchase-orders/new/page.tsx:1>) | `205bf7834daebc015f4c9fb9c2d20cf5e79b25d21dbe32cd37ceeb2a0e4ca281` |

### Reproducible isolated harness (retained inside this report only)

The following is the exact executed harness. It reads source files and the existing Zod/TypeScript installations, injects an in-memory database model, and prints JSON. It does not install dependencies, create files, open database connections or invoke the application server. It was supplied to Node through standard input from the repository root. It is included as evidence, not as authorization to run database-backed integration tests. Its limitations above are essential to interpreting its PASS/FAIL output.

```javascript
'use strict';
const fs=require('fs'), vm=require('vm'), crypto=require('crypto'), assert=require('assert/strict');
const ts=require('./web/node_modules/typescript'), zod=require('zod');
const results=[], hashes={};
const clone=x=>structuredClone(x);
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={po:uuid(1),item:uuid(2),variant:uuid(3),product:uuid(4),supplier:uuid(5),user:uuid(6),otherUser:uuid(7),otherProduct:uuid(8)};
function source(file){const s=fs.readFileSync(file,'utf8');hashes[file]=crypto.createHash('sha256').update(s).digest('hex');return s;}
function load(file,deps,globals={}){
 const module={exports:{}};
 vm.runInNewContext(source(file),{module,exports:module.exports,require:n=>{
  if(!Object.hasOwn(deps,n))throw Error('BLOCKED import '+n);return deps[n];
 },console,...globals},{filename:file,timeout:5000});
 return module.exports;
}
class AppError extends Error{constructor(code,message,opts={}){super(message||code);this.code=code;this.status=opts.status;}}
const errors={AppError,ERROR_CODES:new Proxy({},{get:(_,key)=>key})};
const dates={STORE_TIMEZONE:'Asia/Dubai',todayStoreDate:()=> '2026-10-23',storeDate:x=>new Date(x).toISOString().slice(0,10)};
const round=n=>Math.round((Number(n)+1e-10)*100)/100;
async function test(id,name,fn){try{const detail=await fn();results.push({id,name,status:'PASS',detail:detail||'Expected assertion satisfied at isolated boundary.'});}
 catch(e){if(e.message.startsWith('UNMODELED')||e.message.startsWith('BLOCKED'))throw e;
 results.push({id,name,status:'FAIL',detail:e.message});}}
function fixture(opts={}){
 let state={
 po:{id:ids.po,po_number:'PO-AUDIT',supplier_id:ids.supplier,employee_id:ids.user,status:'confirmed',subtotal:55,tax_amount:2.75,total_cost:57.75,amount_paid:0,balance_due:57.75,payment_status:'unpaid',vat_amount:0},
 items:[{id:ids.item,purchase_order_id:ids.po,product_id:ids.product,variant_id:ids.variant,quantity:55,quantity_received:0,cost_price_per_unit:1}],
 variant:{id:ids.variant,product_id:ids.product,stock_qty:20,quarantine_qty:0,cost_price:1},
 movements:[],history:[],payments:[],journals:[],bankTx:[],
 banks:[{id:'bankA',bank_name:'A',current_balance:1000,is_default:true,is_active:true},{id:'bankB',bank_name:'B',current_balance:1000,is_default:false,is_active:true}],
 ...clone(opts.state||{})};
 const calls=[]; let saved=null, released=0;
 const fail=opts.fail||(()=>false);
 async function query(sql,args=[]){
  const s=sql.replace(/\s+/g,' ').trim();calls.push({sql:s,args:clone(args)});
  if(s==='BEGIN'){saved=clone(state);return {rows:[]};}
  if(s==='COMMIT'){saved=null;return {rows:[]};}
  if(s==='ROLLBACK'){state=saved; saved=null;return {rows:[]};}
  if(fail(s,args))throw new Error('synthetic failure');
  const rows=r=>({rows:clone(r),rowCount:r.length});
  if(s.startsWith('SELECT * FROM purchase_orders'))return rows(state.po?[state.po]:[]);
  if(s.startsWith('SELECT status FROM purchase_orders'))return rows([{status:state.po.status}]);
  if(s.startsWith('SELECT COALESCE(SUM(quantity_received'))return rows([{value:state.items.reduce((n,i)=>n+i.quantity_received*i.cost_price_per_unit,0)}]);
  if(s.startsWith('SELECT COALESCE(SUM(quantity *'))return rows([{subtotal:state.items.reduce((n,i)=>n+i.quantity*i.cost_price_per_unit,0)}]);
  if(s.startsWith('SELECT vat_enabled'))return rows([{vat_enabled:true,vat_rate:5}]);
  if(s.startsWith('SELECT * FROM purchase_order_items'))return rows(state.items.filter(i=>i.id===args[0]&&i.purchase_order_id===args[1]));
  if(s.startsWith('SELECT quantity, quantity_received'))return rows(state.items);
  if(s.startsWith('SELECT id, product_id, stock_qty'))return rows([state.variant]);
  if(s.startsWith('SELECT unit_label FROM products'))return rows([{unit_label:'pcs'}]);
  if(s.startsWith('SELECT cost_price FROM product_variants'))return rows([{cost_price:state.variant.cost_price}]);
  if(s.startsWith('UPDATE product_variants SET stock_qty')){state.variant.stock_qty=round(args[0]);state.variant.quarantine_qty=round(args[1]);return rows([]);}
  if(s.startsWith('UPDATE product_variants SET cost_price')){state.variant.cost_price=args[0];return rows([]);}
  if(s.startsWith('INSERT INTO stock_movements')){
   const keys=['product_id','variant_id','movement_type','quantity','qty_before','qty_after','reference_type','reference_id','unit_label','employee_id','notes'];
   const m=Object.fromEntries(keys.map((k,i)=>[k,args[i]]));m.id='movement'+state.movements.length;m.timestamp='2026-10-23T08:00:00Z';
   for(const k of ['quantity','qty_before','qty_after'])m[k]=round(m[k]);state.movements.push(m);return rows([m]);}
  if(s.startsWith('UPDATE purchase_order_items SET quantity_received')){const it=state.items.find(i=>i.id===args[1]);it.quantity_received=round(it.quantity_received+args[0]);return rows([]);}
  if(s.startsWith('INSERT INTO product_cost_history')){state.history.push({product_id:args[0],variant_id:args[1],po_id:args[2],supplier_id:args[3],cost:args[4],qty:round(args[5]),actor:args[6]});return rows([]);}
  if(s.startsWith('UPDATE purchase_orders SET vat_amount')){state.po.vat_amount=args[0];return rows([]);}
  if(s.startsWith('UPDATE purchase_orders SET status = $1')){state.po.status=args[0];return rows([]);}
  if(s.startsWith('UPDATE purchase_orders SET amount_paid')){Object.assign(state.po,{amount_paid:args[0],balance_due:args[1],payment_status:args[2]});return rows([]);}
  if(s.startsWith('UPDATE purchase_orders SET subtotal')){Object.assign(state.po,{subtotal:args[0],tax_amount:args[1],total_cost:args[2],balance_due:round(args[2]-state.po.amount_paid)});return rows([]);}
  if(s.startsWith('INSERT INTO supplier_payments')){
   const keys=['purchase_order_id','supplier_id','amount','payment_method','bank_account_id','payment_date','employee_id','receipt_attachment','notes'];
   const p=Object.fromEntries(keys.map((k,i)=>[k,args[i]]));p.id='payment'+state.payments.length;p.created_at='2026-10-23T08:00:00Z';state.payments.push(p);return rows([p]);}
  if(s.startsWith('SELECT * FROM supplier_payments'))return rows(state.payments.filter(p=>p.id===args[0]));
  if(s.startsWith('DELETE FROM supplier_payments')){state.payments=state.payments.filter(p=>p.id!==args[0]);return rows([]);}
  if(s.startsWith('SELECT * FROM bank_accounts WHERE id'))return rows(state.banks.filter(b=>b.id===args[0]));
  if(s.startsWith('SELECT * FROM bank_accounts'))return rows([state.banks.find(b=>b.is_default&&b.is_active)||state.banks.find(b=>b.is_active)]);
  if(s.startsWith('INSERT INTO bank_transactions')){
   const keys=['bank_account_id','transaction_type','direction','amount','balance_before','balance_after','reference_type','reference_id','employee_id','transaction_date','description','receipt_attachment','notes'];
   const t=Object.fromEntries(keys.map((k,i)=>[k,args[i]]));t.id='banktx'+state.bankTx.length;state.bankTx.push(t);return rows([t]);}
  if(s.startsWith('UPDATE bank_accounts')){state.banks.find(b=>b.id===args[1]).current_balance=args[0];return rows([]);}
  if(s.startsWith('SELECT id, name, is_active FROM suppliers'))return rows([{id:ids.supplier,name:'Synthetic supplier',is_active:true}]);
  if(s.startsWith('INSERT INTO purchase_orders')){state.po={...state.po,po_number:args[0],supplier_id:args[1],employee_id:args[2],order_date:args[3],expected_date:args[4],due_date:args[5],status:'draft',notes:args[6],created_at:'2026-10-23T08:00:00Z'};state.items=[];return rows([{id:ids.po}]);}
  if(s.startsWith('INSERT INTO purchase_order_items')){state.items.push({id:ids.item,purchase_order_id:args[0],product_id:args[1],variant_id:args[2],quantity:round(args[3]),unit_label:args[4],cost_price_per_unit:args[5],quantity_received:0});return rows([]);}
  if(s.startsWith('SELECT po.*'))return rows([{...state.po,supplier_name:'Synthetic supplier',employee_username:'synthetic-user'}]);
  if(s.startsWith('SELECT i.*'))return rows(state.items);
  throw Error('UNMODELED SQL: '+s);
 }
 class Pool{async connect(){return {query,release:()=>{released++;}};}query(sql,a){return query(sql,a);}on(){}}
 const db=load('server/db/postgres.js',{pg:{Pool},'../utils/dates':dates},{process:{env:{}},setTimeout:()=>{throw Error('No timers allowed');}});
 const journal={
  postPurchaseReceiveEntry:async(client,p)=>{if(opts.failJournal)throw Error('synthetic journal failure');state.journals.push({kind:'receipt',...clone(p)});},
  postSupplierPaymentEntry:async(client,p)=>{if(opts.failJournal)throw Error('synthetic journal failure');state.journals.push({kind:'payment',...clone(p)});},
  reverseSupplierPaymentEntries:async(client,paymentId,p)=>{state.journals.push({kind:'reversal',paymentId,...clone(p)});}
 };
 const bank=load('server/services/bankService.js',{'../db/postgres':db,'../utils/dates':dates,'../../shared/errorCodes':errors,'../utils/activityLog':{logActivity:async()=>{}}});
 const stock=load('server/services/stockService.js',{'../db/postgres':db,'../utils/dates':dates,'../../shared/errorCodes':errors,'./reorderService':{checkReorderThreshold:async()=>null},'./journalService':journal,'./notificationService':{}});
 const po=load('server/services/purchaseOrderService.js',{'../db/postgres':db,'../utils/dates':dates,'../../shared/errorCodes':errors,'./stockService':stock,'../utils/docNumbers':{nextDocumentNumber:async()=>({formatted:'PO-AUDIT'})},'./journalService':journal});
 const payment=load('server/services/supplierPaymentService.js',{'../db/postgres':db,'../utils/dates':dates,'../../shared/errorCodes':errors,'./journalService':journal,'./bankService':bank,'./cashService':{recordCashOut:async()=>{throw Error('Cash boundary not implemented in harness');},recordCashIn:async()=>{throw Error('Cash boundary not implemented in harness');}}});
 function controller(service=po){
  return load('server/controllers/purchaseOrdersController.js',{
   zod,'../utils/dates':dates,'../db/postgres':db,'../utils/response':{ok:(_,b)=>b,created:(_,b)=>b,parsePagination:()=>({})},
   '../../shared/errorCodes':errors,'../utils/activityLog':{logActivity:async()=>{}},
   '../services/purchaseOrderService':service,'../utils/upload':{}
  });
 }
 return {state:()=>state,calls,db,po,payment,stock,controller,released:()=>released,
 receive:q=>po.receiveItems({poId:ids.po,items:[{id:ids.item,quantityReceived:q}],employeeId:ids.user}),
 pay:(amount,extra={})=>payment.addPayment({poId:ids.po,amount,method:'bank_transfer',employeeId:ids.user,...extra})};
}
(async()=>{
 await test('I01','Receive example 20 + 30 + 25; PO 55 fully received',async()=>{
  const h=fixture();await h.receive(30);assert.equal(h.state().variant.stock_qty,50);assert.equal(h.state().items[0].quantity_received,30);assert.equal(h.state().po.status,'partially_received');
  await h.receive(25);assert.equal(h.state().variant.stock_qty,75);assert.equal(h.state().items[0].quantity_received,55);assert.equal(h.state().po.status,'received');
  return 'Isolated SQL model: stock 20→50→75; received 0→30→55; remaining 55→25→0.';
 });
 await test('I02','Each receipt issues movement with actor, PO, quantity and before/after',async()=>{
  const h=fixture();await h.receive(30);await h.receive(25);
  assert.equal(h.state().movements.length,2);
  assert.deepEqual(h.state().movements.map(m=>[m.quantity,m.qty_before,m.qty_after,m.employee_id,m.reference_id]),[[30,20,50,ids.user,ids.po],[25,50,75,ids.user,ids.po]]);
  assert.ok(h.calls.some(c=>c.sql.includes('clock_timestamp()')));
 });
 await test('I03','Over-receipt rejected and wrapper rolls back',async()=>{
  const h=fixture();await h.receive(30);await assert.rejects(h.receive(26),e=>e.code==='BIZ_RECEIVE_EXCEEDS_ORDER');
  assert.equal(h.state().variant.stock_qty,50);assert.equal(h.calls.at(-1).sql,'ROLLBACK');
 });
 await test('I04','Draft/cancelled/received/closed receipts rejected',async()=>{
  for(const status of ['draft','cancelled','received','closed']){const h=fixture();h.state().po.status=status;await assert.rejects(h.receive(1),e=>e.code==='BIZ_INVALID_STATE');}
 });
 await test('I05','HTTP receive schema rejects zero and negative quantities',async()=>{
  for(const q of [0,-1]){const h=fixture();let err;await h.controller().receive({params:{id:ids.po},body:{items:[{id:ids.item,quantityReceived:q}]},user:{id:ids.user,permissions:[]},app:{get:()=>null}}, {},e=>{err=e;});assert.equal(err?.name,'ZodError');assert.equal(h.state().movements.length,0);}
 });
 await test('I06','Duplicate partial receive is idempotent',async()=>{
  const h=fixture();await h.receive(10);await h.receive(10);assert.equal(h.state().variant.stock_qty,30,'Same partial request applied twice: stock is 40, expected 30 for one delivery');
 });
 await test('I07','Duplicate line IDs within one receive are rejected/deduplicated',async()=>{
  const h=fixture();await h.po.receiveItems({poId:ids.po,employeeId:ids.user,items:[{id:ids.item,quantityReceived:10},{id:ids.item,quantityReceived:10}]});
  assert.equal(h.state().items[0].quantity_received,10,'Repeated line ID applied twice within one operation');
 });
 await test('I08','Split fractional receipts preserve net ledger value',async()=>{
  const h=fixture();Object.assign(h.state().items[0],{quantity:1,cost_price_per_unit:0.01});Object.assign(h.state().po,{subtotal:0.01,tax_amount:0,total_cost:0.01});
  await h.receive(0.5);await h.receive(0.5);
  assert.equal(round(h.state().journals.reduce((n,j)=>n+j.inventoryValue,0)),0.01,'Two half-unit receipts post 0.01 each = 0.02 against a 0.01 net PO');
 });
 await test('I09','Partial VAT allocation sums to PO tax',async()=>{
  const h=fixture();Object.assign(h.state().items[0],{quantity:3,cost_price_per_unit:33.33});Object.assign(h.state().po,{subtotal:99.99,tax_amount:5});
  await h.receive(1);await h.receive(1);await h.receive(1);
  assert.equal(round(h.state().journals.reduce((n,j)=>n+j.vatAmount,0)),5);
 });
 await test('I10','Product/variant ownership mismatch rejected',async()=>{
  const h=fixture();h.state().items[0].product_id=ids.otherProduct;
  await h.receive(1);assert.equal(h.state().movements[0].product_id,h.state().variant.product_id,'Movement records supplied product B while stock belongs to variant of product A');
 });
 await test('I11','Payment example 57.75 minus 20 then 37.75',async()=>{
  const h=fixture();await h.pay(20);assert.equal(h.state().po.amount_paid,20);assert.equal(h.state().po.balance_due,37.75);assert.equal(h.state().po.payment_status,'partial');
  await h.pay(37.75);assert.equal(h.state().po.amount_paid,57.75);assert.equal(h.state().po.balance_due,0);assert.equal(h.state().po.payment_status,'paid');assert.equal(h.state().payments.length,2);
 });
 await test('I12','Overpayment rejected using current PO balance',async()=>{
  const h=fixture();await h.pay(20);await assert.rejects(h.pay(37.76),e=>e.code==='BIZ_PAYMENT_EXCEEDS_BALANCE');assert.equal(h.state().payments.length,1);
 });
 await test('I13','Nonpositive or invalid payment methods rejected',async()=>{
  const h=fixture();for(const amt of [0,-1,0.001])await assert.rejects(h.pay(amt),e=>e.code==='VALIDATION_FAILED');
  await assert.rejects(h.pay(1,{method:'invalid'}),e=>e.code==='VALIDATION_FAILED');
 });
 await test('I14','Cancelled PO payment rejected',async()=>{
  const h=fixture();h.state().po.status='cancelled';await assert.rejects(h.pay(1),e=>e.code==='BIZ_INVALID_STATE');
 });
 await test('I15','Duplicate partial payment is idempotent',async()=>{
  const h=fixture();await h.pay(20);await h.pay(20);assert.equal(h.state().po.amount_paid,20,'Same partial payment applied twice; paid total becomes 40');
 });
 await test('I16','Receiver identity comes from authenticated request',async()=>{
  const h=fixture();let captured;const ctrl=h.controller({...h.po,receiveItems:async p=>{captured=p;return {po:h.state().po,affectedVariants:[],costChanges:[]};}});
  let err;await ctrl.receive({params:{id:ids.po},body:{employeeId:ids.otherUser,items:[{id:ids.item,quantityReceived:1}]},user:{id:ids.user,permissions:[]},app:{get:()=>null}}, {},e=>{err=e;});
  assert.equal(err,undefined);assert.equal(captured.employeeId,ids.user);
 });
 await test('I17','Payment stores caller actor, method, PO, and business date',async()=>{
  const h=fixture();await h.pay(20,{paymentDate:'2026-10-20'});const p=h.state().payments[0];
  assert.equal(p.employee_id,ids.user);assert.equal(p.purchase_order_id,ids.po);assert.equal(p.payment_date,'2026-10-20');assert.equal(p.payment_method,'bank_transfer');
 });
 await test('I18','Reversal treasury/journal actor is the reversing user',async()=>{
  const h=fixture();const {payment}=await h.pay(20);await h.payment.deletePayment({paymentId:payment.id,employeeId:ids.otherUser});
  assert.equal(h.state().journals.at(-1).userId,ids.otherUser,'Reversal uses original payer ID, not the manager executing reversal');
 });
 await test('I19','Reversal preserves original payment record',async()=>{
  const h=fixture();const {payment}=await h.pay(20);await h.payment.deletePayment({paymentId:payment.id});
  assert.equal(h.state().payments.length,1,'Payment is physically deleted; no reversed status is retained');
 });
 await test('I20','Resolved default bank is saved on supplier payment',async()=>{
  const h=fixture();await h.pay(20);assert.equal(h.state().payments[0].bank_account_id,'bankA','Bank transaction uses bankA but supplier payment stores NULL');
 });
 await test('I21','Reversal returns money to original bank after default changes',async()=>{
  const h=fixture();const {payment}=await h.pay(20);h.state().banks[0].is_default=false;h.state().banks[1].is_default=true;
  await h.payment.deletePayment({paymentId:payment.id});
  assert.equal(h.state().banks[0].current_balance,1000,'Original bank stays 980; reversal credits newly default bankB to 1020');
 });
 await test('I22','Bank transaction business date matches payment date',async()=>{
  const h=fixture();await h.pay(20,{paymentDate:'2026-10-20'});
  assert.equal(h.state().bankTx[0].transaction_date,'2026-10-20','Bank service receives no transactionDate and uses today, while payment/journal use selected earlier date');
 });
 await test('I23','Cheque marked paid has a matching settlement/accounting lifecycle',async()=>{
  const h=fixture();await h.pay(57.75,{method:'cheque'});
  assert.ok(h.state().journals.length>0 || h.state().po.payment_status!=='paid','Cheque makes PO paid with no treasury or journal entry; no pending state passed');
 });
 await test('I24','Audit failure prevents silent success',async()=>{
  let warned=false;
  const audit=load('server/utils/activityLog.js',{'../db/postgres':{query:async()=>{throw Error('synthetic audit DB error');}}},{console:{warn:()=>{warned=true;}}});
  let rejected=false;try{await audit.logActivity({entityType:'purchase_order',entityId:ids.po,action:'purchase_order.received',performedBy:ids.user});}catch{rejected=true;}
  assert.ok(warned);assert.ok(rejected,'Audit writer resolves after failed INSERT; business action can succeed without audit');
 });
 await test('I25','Journal failure triggers real wrapper ROLLBACK and release',async()=>{
  const h=fixture({failJournal:true});await assert.rejects(h.receive(30),/synthetic journal failure/);
  assert.equal(h.calls.at(-1).sql,'ROLLBACK');assert.equal(h.released(),1);assert.equal(h.state().variant.stock_qty,20);assert.equal(h.state().movements.length,0);
  return 'Actual withTransaction emitted ROLLBACK/release; data restoration is the fake SQL model, not real PostgreSQL evidence.';
 });
 await test('I26','Wizard does not announce payment success after payment failure',async()=>{
  const file='web/app/(dashboard)/purchase-orders/new/page.tsx',s=source(file), ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let fn;
  function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='save')fn=n;ts.forEachChild(n,visit);}visit(ast);assert.ok(fn);
  const code=ts.transpileModule(fn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const successes=[],warnings=[];
  const context={supplier:{id:ids.supplier},items:[{productId:ids.product,variantId:ids.variant,quantity:1,costPricePerUnit:55}],markReceived:false,allItemsReceived:'no',payKind:'full',total:57.75,payAmount:0,recordPayment:true,payMethod:'bank_transfer',money2:round,orderDate:'2026-10-23',expectedDate:'',dueDate:'',taxAmount:2.75,notes:'',setSaving:()=>{},setStep:()=>{},todayISO:()=> '2026-10-23',createPurchaseOrder:async()=>({id:ids.po,poNumber:'PO-AUDIT'}),confirmPurchaseOrder:async()=>{},getPurchaseOrder:async()=>({balanceDue:57.75}),addPoPayment:async()=>{throw Error('synthetic payment failure');},toast:{warning:m=>warnings.push(m),success:m=>successes.push(m),error:()=>{}},router:{push:()=>{}}};
  vm.createContext(context);vm.runInContext(code,context);await context.save(false);
  assert.equal(warnings.length,1);assert.ok(!successes.some(s=>s.includes('payment recorded')),'Wizard warns payment failed then announces confirmed and payment recorded');
 });
 await test('I27','Server calculates VAT from settings',async()=>{
  const h=fixture();await h.po.recalculatePOTotals({query:h.db.query},ids.po);assert.equal(h.state().po.subtotal,55);assert.equal(h.state().po.tax_amount,2.75);assert.equal(h.state().po.total_cost,57.75);
 });
 await test('I28','PO create binds authenticated creator and supplies database timestamp defaults',async()=>{
  const h=fixture();let err;
  const body={supplierId:ids.supplier,employeeId:ids.otherUser,createdAt:'1900-01-01',taxAmount:999,items:[{productId:ids.product,variantId:ids.variant,quantity:55,costPricePerUnit:1}]};
  await h.controller().create({body,user:{id:ids.user,username:'synthetic',permissions:['product.view_cost']},app:{get:()=>null}}, {},e=>{err=e;});
  if(err)throw err;assert.equal(h.state().po.employee_id,ids.user);assert.equal(h.state().po.total_cost,57.75);
  const insert=h.calls.find(c=>c.sql.startsWith('INSERT INTO purchase_orders'));assert.ok(!insert.sql.includes('created_at'));
  return 'Creator parameter is authenticated user; caller timestamp omitted from INSERT; actual DB timestamp generation not executed.';
 });
 await test('I29','Unsupported sub-cent quantity precision rejected at receive API',async()=>{
  const h=fixture();let reached=false;
  const ctrl=h.controller({...h.po,receiveItems:async()=>{reached=true;throw Error('stop after schema');}});
  await ctrl.receive({params:{id:ids.po},body:{items:[{id:ids.item,quantityReceived:0.004}]},user:{id:ids.user,permissions:[]},app:{get:()=>null}}, {},()=>{});
  assert.equal(reached,false,'0.004 passes positive-number schema despite DECIMAL(12,2) quantity storage');
 });
 await test('I30','Paid draft cannot be edited below amount paid',async()=>{
  const h=fixture();h.state().po.status='draft';await h.pay(20);h.state().items[0].quantity=10;
  await h.po.recalculatePOTotals({query:h.db.query},ids.po);
  assert.ok(h.state().po.balance_due>=0,'Draft accepted payment; recalculation reduces gross to 10.50, leaves paid 20 and balance -9.50');
 });
 await test('I31','Latest-cost valuation reconciles to historic receipts',async()=>{
  const h=fixture();h.state().variant.cost_price=5;h.state().items[0].cost_price_per_unit=10;h.state().po.subtotal=550;h.state().po.tax_amount=0;
  await h.receive(30);
  const reportingValue=h.state().variant.stock_qty*h.state().variant.cost_price;
  const historicValue=20*5+h.state().journals[0].inventoryValue;
  assert.equal(reportingValue,historicValue,'Latest-cost report values 50×10=500; opening 20×5 plus received 30×10 =400');
 });
 await test('I32','Successful receive uses PO, item and variant lock SQL on one client',async()=>{
  const h=fixture();await h.receive(30);
  assert.ok(h.calls.some(c=>c.sql==='SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE'));
  assert.ok(h.calls.some(c=>c.sql.includes('purchase_order_items')&&c.sql.includes('FOR UPDATE')));
  assert.ok(h.calls.some(c=>c.sql.includes('FROM product_variants')&&c.sql.includes('FOR UPDATE')));
  assert.equal(h.calls[0].sql,'BEGIN');assert.equal(h.calls.at(-1).sql,'COMMIT');
  return 'Lock statements and transaction plumbing executed against fake client; real lock contention/isolation NOT TESTED.';
 });
 await test('I33','Sequential full-payment duplicate rejected after balance exhausted',async()=>{
  const h=fixture();await h.pay(57.75);await assert.rejects(h.pay(57.75),e=>e.code==='BIZ_PAYMENT_EXCEEDS_BALANCE');assert.equal(h.state().payments.length,1);
 });
 console.log(JSON.stringify({runtime:process.version,isolation:'Explicit VM imports; fake pg Pool and in-memory SQL model; journal/treasury boundaries as documented; no network, real DB, timers or file writes',results,sourceHashes:hashes},null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
```

