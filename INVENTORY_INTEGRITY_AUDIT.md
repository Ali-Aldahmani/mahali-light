# Bytecra POS — Inventory Integrity Audit

**Audit date:** 2026-10-26  
**Mode:** Read-only source and test audit  
**Systems traced:** Next.js frontend, Express API, PostgreSQL migrations/queries, Socket.io synchronization

## Executive summary

The central stock mutation engine is materially stronger than the surrounding inventory workflows: it serializes variant updates with `SELECT ... FOR UPDATE`, refuses negative quantities, records the movement in the same transaction, and is reused by sales, purchase receipts, returns, cancellations, direct adjustments, and stock-count corrections. Purchase receiving and direct stock adjustments also have durable idempotency keys. The safe test suites that could run locally passed: **127 passed, 0 failed**.

The audit nevertheless found **10 failed controls**: 3 High, 6 Medium, and 1 Low. The most important financial-integrity defect is that FIFO does not exist. A receipt overwrites the variant's single current cost, current inventory is valued entirely at that cost, and subsequent invoice COGS snapshots that latest cost. Mixed-cost stock can therefore be materially misstated. Two approval/rejection workflows also contain a verified time-of-check/time-of-use race that can apply stock and later label the source request rejected. Barcode namespaces are not unique across primary and supplier barcodes, so a scanner can resolve an ambiguous code to an arbitrary variant.

Database-backed integration and concurrency suites were present but deliberately not executed because their disposable PostgreSQL opt-in (`INVOICE_TEST_PG_PORT`) was unavailable. No production or development database was queried. Findings identified directly from reachable code and DDL are marked **Verified**; runtime-only risks are marked **Suspected / not runtime-verified**.

### Overall result

| Severity | FAIL | PASS | NOT TESTED |
|---|---:|---:|---:|
| Critical | 0 | 0 | 0 |
| High | 3 | 0 | 0 |
| Medium | 6 | 4 | 1 |
| Low | 1 | 0 | 0 |

## Findings table

| ID | Severity | Status | Feature | Result |
|---|---|---|---|---|
| INV-001 | High | FAIL | FIFO costing and valuation | No FIFO layers; latest receipt cost rewrites all on-hand value and later COGS |
| INV-002 | High | FAIL | Adjustment/count approval | Reject can race approval and relabel an already-applied movement as rejected |
| INV-003 | High | FAIL | Barcode uniqueness | Supplier and primary barcode namespaces can collide; lookup returns an arbitrary match |
| INV-004 | Medium | FAIL | Quantity validation | Several ingress paths accept precision PostgreSQL silently rounds to two decimals |
| INV-005 | Medium | FAIL | Stock counts/concurrency | “One active count” is application-only and racy; count/adjustment exclusion is also non-atomic |
| INV-006 | Medium | FAIL | Low-stock alerts | Threshold edits do not reconcile pending alerts; post-commit alert refresh is best-effort |
| INV-007 | Medium | FAIL | Movement history valuation | Historical movement value is recalculated using the variant's current cost |
| INV-008 | Medium | FAIL | Product/variant retry safety | Creates and opening stock lack idempotency protection |
| INV-009 | Medium | FAIL | Stock transfers | No inventory-location or stock-transfer model/API exists |
| INV-010 | Low | FAIL | Database invariants | Important movement, state, and quantity-domain rules are application-only |
| INV-011 | Medium | PASS | Negative stock/overselling | Row locks, transactional recheck, and DB nonnegative checks protect stock |
| INV-012 | Medium | PASS | Sales and customer returns | Stock, invoice/return state, and accounting are transactionally coupled |
| INV-013 | Medium | PASS | Purchase receiving/supplier returns | Receiving is locked, atomic, and idempotent; supplier returns are atomic and retry-safe |
| INV-014 | Medium | PASS | Socket.io synchronization | Authenticated events update clients; reconnect performs authoritative full sync |
| INV-015 | Medium | NOT TESTED | PostgreSQL runtime/reconciliation | Live constraints, rollback, deadlocks, and existing-data consistency were not exercised |

## Detailed findings

### INV-001 — FIFO inventory costing is absent and latest cost misstates valuation and COGS

- **Severity:** High
- **Status:** FAIL
- **Classification:** Verified from implementation and schema
- **Feature / vulnerability:** FIFO costing, inventory valuation, and COGS accuracy
- **Locations and functions:**
  - `server/services/purchaseOrderService.js:102`, `receiveItems`
  - `server/services/purchaseOrderService.js:197-228`, `receiveItems`
  - `server/services/invoiceService.js:299-316`, `replaceItems`
  - `server/services/invoiceService.js:675-689`, `confirmInvoice`
  - `server/controllers/stockReportsController.js:112-157`, `valuation`
  - `server/db/migrations/004_suppliers.sql:68-79`, `product_cost_history` DDL
- **Expected behavior:** Receipts create immutable quantity/cost layers. Sales deplete the oldest available layer and post COGS from the consumed layers; on-hand valuation equals the remaining layers.
- **Actual behavior:** Receipt history is recorded, but the receipt then overwrites `product_variants.cost_price` with the newest purchase price. Invoice lines snapshot that single current value and valuation queries multiply every on-hand unit by it. `product_cost_history` has no remaining-quantity field and is never depleted, so it is not a FIFO ledger.
- **Evidence:** `receiveItems` inserts cost history at lines 197-212 and immediately updates the variant to `newCost` at lines 214-228. Invoice creation stores `v.cost_price` in `cost_price_at_time` at lines 299-316; confirmation posts COGS from that snapshot at lines 675-689. Valuation uses `SUM(v.stock_qty * v.cost_price)` at `stockReportsController.js:120-139`. No cost-layer/lot table or FIFO depletion service exists in the migrations or inventory services.
- **Safe reproduction:** In a disposable database, create/receive 10 units at AED 10, then receive 1 unit at AED 100. Query the valuation endpoint: current code reports 11 × 100 = AED 1,100 rather than AED 200. Sell one unit: the invoice snapshots AED 100 COGS rather than the oldest AED 10 layer.
- **Root cause:** The data model treats cost as a mutable variant attribute, not a quantity-bearing inventory layer.
- **Recommended fix:** Add immutable receipt/return/opening cost layers with received, remaining, and source quantities. Lock and deplete FIFO layers during every stock-out in the same transaction. Snapshot actual consumed-layer cost on invoice/return/journal records and rebuild valuation from remaining layers. Reconcile historical stock before enabling the new method.

### INV-002 — Approval/rejection races can leave applied stock marked rejected

- **Severity:** High
- **Status:** FAIL
- **Classification:** Verified concurrency defect
- **Feature / vulnerability:** Adjustment and stock-count approval workflows
- **Locations and functions:**
  - `server/controllers/stockAdjustmentsController.js:381-438`, `approve`
  - `server/controllers/stockAdjustmentsController.js:502-530`, `reject`
  - `server/controllers/stockCountsController.js:522-624`, `approve`
  - `server/controllers/stockCountsController.js:689-714`, `reject`
- **Expected behavior:** Approval and rejection are mutually exclusive transitions serialized on the workflow row. A rejected record must never have applied inventory effects.
- **Actual behavior:** Approval locks the row and applies movements transactionally. Rejection first reads without a lock, then performs an unconditional update with no `status = pending...` predicate. A reject request can read “pending,” wait while approval commits stock changes, and then overwrite the final status to `rejected`.
- **Evidence:** Adjustment approval uses `FOR UPDATE` at lines 387-400 and writes movement/status at lines 412-435. Rejection reads at lines 507-520 and updates solely by `id` at lines 522-530. Stock counts repeat the same pattern: approval locks and applies corrections at lines 526-624, while rejection does an unlocked read followed by an unconditional update at lines 694-714.
- **Safe reproduction:** In an isolated database, pause rejection after its initial `SELECT`; approve the same pending record in another transaction; resume rejection. Verify stock/movement exists while the workflow row is `rejected`. Repeat with a pending stock count.
- **Root cause:** State validation and state mutation are separate transactions in the reject paths.
- **Recommended fix:** Put rejection in a transaction, lock the workflow row, and transition with a guarded update (`... WHERE id = $n AND status = 'pending' RETURNING ...`). Use the same state-machine pattern for approve/reject and add a concurrency integration test.

### INV-003 — Barcode namespaces can collide and scanner lookup is nondeterministic

- **Severity:** High
- **Status:** FAIL
- **Classification:** Verified from DDL and query
- **Feature / vulnerability:** Product/variant validation, barcode uniqueness, and scan-to-stock identity
- **Locations and functions:**
  - `server/db/migrations/002_products.sql:57-72`, `product_variants` DDL
  - `server/controllers/variantsController.js:121-183`, `create`
  - `server/controllers/variantsController.js:224-297`, `update`
  - `server/controllers/variantsController.js:419-434`, `findByBarcode`
- **Expected behavior:** Every scannable identifier resolves to exactly one active variant across primary, internal, and supplier barcode fields.
- **Actual behavior:** Only `internal_barcode` is unique. `supplier_barcode` and legacy `barcode` are not; create/update only check the internal field. Lookup searches all three columns with `OR ... LIMIT 1` and no deterministic precedence or collision rejection.
- **Evidence:** DDL marks SKU and internal barcode unique at lines 60-62 but not supplier/legacy barcode at lines 61 and 63. Create checks only `internal_barcode` at `variantsController.js:155-165`; update does the same at lines 253-267. Lookup at lines 423-430 may return any matching row.
- **Safe reproduction:** In an isolated database, create variant A with primary barcode `X`; create variant B with supplier barcode `X`; call the barcode lookup repeatedly or scan `X` at POS. More than one database row qualifies, so the selected product is not guaranteed.
- **Root cause:** Scannable identifiers are stored in independent nullable columns without a shared uniqueness domain.
- **Recommended fix:** Normalize barcodes into a child table with one globally unique normalized value per code and an explicit type/priority. Before migration, detect collisions and require resolution; never silently choose one match.

### INV-004 — Quantity precision rules are inconsistent and can silently lose stock

- **Severity:** Medium
- **Status:** FAIL
- **Classification:** Verified from validation and column types
- **Feature / vulnerability:** Opening stock, receipts, adjustments, counts, and unit validation
- **Locations and functions:**
  - `server/controllers/productsController.js:25-65`, `baseProductSchema` / `simpleVariantSchema`
  - `server/controllers/variantsController.js:21-30`, `createSchema`
  - `server/controllers/stockAdjustmentsController.js:22-29`, `createSchema`
  - `server/controllers/purchaseOrdersController.js:45-54`, `receiveSchema`
  - `server/controllers/stockCountsController.js:17-27`, `itemsSchema`
  - `server/services/stockService.js:191-235`, `applyStockMovement`
  - `server/db/migrations/002_products.sql:64-68`, `product_variants` DDL
  - `server/db/migrations/003_stock.sql:5-18`, `stock_movements` DDL
- **Expected behavior:** All stock entry points enforce the same quantity scale and sold-by rule; piece/box/roll quantities are integral, and decimal-unit quantities match the database scale.
- **Actual behavior:** Sales validate quantity precision and sold-by semantics, but openings, receipts, adjustments, and counts accept arbitrary finite decimals. The engine rounds to four decimals while PostgreSQL columns are `DECIMAL(12,2)`, so persisted stock and movement values can be rounded differently from values returned/calculated in JavaScript.
- **Evidence:** Opening stock schemas only apply min/max; adjustments accept any positive finite number; receipts accept any positive number; count quantities have no min/scale rule. `applyStockMovement` rounds to four decimals at lines 191-194 and returns that value at lines 257-266, while both stock and movement columns store two decimals.
- **Safe reproduction:** In a disposable database, submit an opening, receipt, adjustment, or count quantity of `0.004` (and `1.5` for a piece-sold item). Compare the API response, movement row, and persisted `stock_qty`; PostgreSQL's two-decimal coercion can erase or alter the requested delta.
- **Root cause:** Quantity-domain logic is implemented only in selected sales code and disagrees with database precision.
- **Recommended fix:** Centralize quantity validation by sold-by type, use decimal arithmetic, use the same scale end-to-end, and add DB checks for permitted scale/integer units. Reject rather than round unsupported input.

### INV-005 — Active stock-count exclusivity and adjustment blocking are racy

- **Severity:** Medium
- **Status:** FAIL
- **Classification:** Verified design race; runtime interleaving not executed
- **Feature / vulnerability:** Stock counts, concurrent sessions, and lost-update prevention
- **Locations and functions:**
  - `server/controllers/stockCountsController.js:236-287`, `create`
  - `server/services/stockService.js:360-375`, `isVariantUnderActiveCount`
  - `server/controllers/stockAdjustmentsController.js:172-225`, `create`
  - `server/db/migrations/003_stock.sql:40-72,101-109`, stock-count DDL/indexes
- **Expected behavior:** At most one active count exists, and no conflicting adjustment can enter/apply while a covered variant is being counted.
- **Actual behavior:** Count creation checks for an existing count before its insert transaction, with no advisory/table lock or partial unique index. Concurrent requests can both observe no active count and insert. Adjustment exclusion is another unlocked pool query, so a count and adjustment can cross between check and write.
- **Evidence:** The existence check is at `stockCountsController.js:240-252`; the insert begins later at lines 263-287. The schema has a non-unique status index but no active-count uniqueness constraint. `isVariantUnderActiveCount` performs a plain query at `stockService.js:364-374` and cannot share the caller's transaction/lock.
- **Safe reproduction:** In an isolated database, synchronize two `POST /stock/counts` calls immediately after both have completed their existence check; both can insert. Similarly interleave adjustment creation with count creation for the same variant.
- **Root cause:** Cross-workflow exclusion relies on non-transactional check-then-act logic.
- **Recommended fix:** Enforce the intended cardinality at the database level (partial unique index if globally one count) or acquire a transaction-scoped advisory lock. Lock count coverage and the variant during adjustment/count transitions. Pass transaction clients through exclusion checks.

### INV-006 — Reorder alerts can become stale after threshold edits or alert-refresh failure

- **Severity:** Medium
- **Status:** FAIL
- **Classification:** Verified from reachable update paths
- **Feature / vulnerability:** Low-stock alerts and reorder points
- **Locations and functions:**
  - `server/controllers/productsController.js:393-447`, `update`
  - `server/controllers/variantsController.js:224-324`, `update`
  - `server/services/reorderService.js:39-131`, `checkReorderThreshold`
  - `server/controllers/purchaseOrdersController.js:648-657`, `receive`
  - `server/controllers/stockCountsController.js:626-639`, `approve`
  - `server/db/migrations/003_stock.sql:106-109`, `uq_reorder_pending_variant`
- **Expected behavior:** Changing a threshold immediately creates, updates, or resolves the corresponding pending alert; committed stock changes eventually reconcile alerts even if notification work fails.
- **Actual behavior:** Product and variant update paths change thresholds but never invoke reconciliation. Receipt and count paths perform checks after commit inside swallowed best-effort blocks. A failed refresh can therefore leave a missing or stale alert until another movement or manual check occurs.
- **Evidence:** Update maps include `reorder_threshold` but end with only product socket emission. The actual reconciliation service correctly creates/refreshes/resolves at `reorderService.js:39-131` and the partial unique index prevents duplicate pending alerts, but it is not durably scheduled from threshold changes.
- **Safe reproduction:** In isolated data, set stock to 5 and threshold to 0, then edit threshold to 10. No alert is created by the edit path. Conversely, lower/disable a threshold with an existing pending alert; it remains until a later check.
- **Root cause:** Alert state is a denormalized projection maintained by optional side effects rather than a durable transactional/outbox workflow.
- **Recommended fix:** Reconcile in the threshold-change transaction or enqueue a durable outbox job. Make alert reconciliation idempotent, retry failures, and periodically reconcile all variants as a backstop.

### INV-007 — Historical stock movement values change when current cost changes

- **Severity:** Medium
- **Status:** FAIL
- **Classification:** Verified from query and schema
- **Feature / vulnerability:** Movement history and financial auditability
- **Locations and functions:**
  - `server/controllers/stockMovementsController.js:21-61`, `shape` / `LIST_SQL`
  - `server/db/migrations/003_stock.sql:5-18`, `stock_movements` DDL
  - `server/services/stockService.js:237-254`, `applyStockMovement`
- **Expected behavior:** A movement's unit cost and value impact are immutable facts as of the movement time and reconcile to the related journal entry.
- **Actual behavior:** `stock_movements` stores quantities but no cost snapshot. The list query joins the variant's current cost and computes `quantity × current cost`. A later receipt or manual cost edit retroactively changes the displayed value of every historical movement, while an earlier journal entry remains at the original then-current cost.
- **Evidence:** The movement DDL has no cost/value column. `LIST_SQL` selects `v.cost_price` at lines 49-61 and `shape` calculates the displayed impact at lines 42-45. Adjustment accounting reads current cost during the original transaction at `stockService.js:237-254`, proving the report can later diverge from the immutable journal.
- **Safe reproduction:** In an isolated database, make an adjustment at cost 10, record its displayed impact, change/receive cost to 20, and read the same movement again. Its displayed value doubles without a new movement.
- **Root cause:** Historical valuation is derived from mutable master data.
- **Recommended fix:** Store an immutable unit-cost and value snapshot (or cost-layer allocations) on every movement and report from that snapshot. Backfill only through an explicitly reviewed reconciliation method.

### INV-008 — Product and variant creation are not idempotent under network retry

- **Severity:** Medium
- **Status:** FAIL
- **Classification:** Verified from API and frontend paths
- **Feature / vulnerability:** Product creation, variant creation, opening stock, retries, and interrupted responses
- **Locations and functions:**
  - `server/controllers/productsController.js:292-385`, `create`
  - `server/controllers/variantsController.js:121-218`, `create`
  - `web/services/productService.ts:39-40`, `createProduct`
  - `web/services/variantService.ts:7-8`, `createVariant`
  - `server/db/migrations/040_operations.sql:12-20`, `operations` DDL
- **Expected behavior:** Retrying a create after a timeout returns the original result and cannot create another product, variant, or opening-stock movement.
- **Actual behavior:** Product/variant creation is transactional, but neither endpoint nor frontend sends/consumes an idempotency key. Explicit SKU/barcode retries may conflict safely, but auto-generated identifiers allow a second record and a second opening balance.
- **Evidence:** Both frontend services post without `withRequestKey`; both controllers lack `runOnce`. A reusable operations table exists and is used by receipts/adjustments, but not these create paths.
- **Safe reproduction:** In isolated data, send a create with auto-generated SKU/barcode and opening stock; simulate a lost response; resend the same payload. Verify a second product/variant and opening movement can be created.
- **Root cause:** Idempotency was applied to selected money/stock commands but omitted from inventory master creation that includes stock effects.
- **Recommended fix:** Require an idempotency key for creates that can establish stock, execute `runOnce` in the same transaction, and have the UI retain the key across retries until a terminal response.

### INV-009 — Stock transfers and location-level inventory are not implemented

- **Severity:** Medium
- **Status:** FAIL
- **Classification:** Verified absence in current schema/routes
- **Feature / vulnerability:** Stock transfers and movement history
- **Locations and functions:**
  - `server/db/migrations/002_products.sql:57-72`, `product_variants` DDL
  - `server/db/migrations/003_stock.sql:5-18`, `stock_movements` DDL
  - `server/routes/stock.js:13-95`, stock router
- **Expected behavior:** The stated inventory scope requires location-aware balances and an atomic transfer that records linked source-out and destination-in movements with a shared transfer identifier.
- **Actual behavior:** A variant has one global `stock_qty` and movements have no warehouse/location. The stock router exposes summary, movements, adjustments, counts, alerts, and reports, but no stock-transfer endpoint. Searches for inventory transfer services/tables found only cash/bank transfer concepts.
- **Evidence:** No inventory-location, bin, warehouse, or transfer DDL appears in migrations; no transfer route appears in `server/routes/stock.js`.
- **Safe reproduction:** Inspect the stock router and schema, or attempt to identify source/destination stock for a variant; neither dimension exists. No runtime mutation is required.
- **Root cause:** The inventory model is single-location.
- **Recommended fix:** If multi-location operation is a business requirement, add per-location balances, immutable transfer headers/lines, and a single transaction that locks both balances in stable order. If Bytecra is intentionally single-location, document that constraint and remove transfer claims from acceptance criteria.

### INV-010 — Database constraints do not enforce the complete inventory domain

- **Severity:** Low
- **Status:** FAIL
- **Classification:** Verified from migrations
- **Feature / vulnerability:** PostgreSQL integrity constraints and defense in depth
- **Locations and functions:**
  - `server/db/migrations/003_stock.sql:5-109`, stock DDL
  - `server/db/migrations/047_financial_constraints.sql:14-40`, constraint-install block
- **Expected behavior:** PostgreSQL rejects impossible movement continuity, invalid workflow states/types, invalid precision, and malformed stock deltas regardless of writer.
- **Actual behavior:** Migration 047 adds nonnegative stock/quarantine and PO receipt-range checks, but as `NOT VALID` constraints. It does not constrain movement types/statuses, enforce `qty_after = qty_before + quantity`, require nonzero movements, or encode piece/integer and scale rules. Existing rows were explicitly not validated.
- **Evidence:** Stock tables use free-form `VARCHAR` state/type columns. Migration 047 lines 18-39 cover nonnegative balances and selected positive amounts only, and comments at lines 6-9 state historical rows are not rechecked.
- **Safe reproduction:** In a disposable database, insert a movement with inconsistent before/after values or an unknown type through a privileged SQL test connection; current DDL has no matching check. Do not run this against production.
- **Root cause:** Business invariants live predominantly in Express validation/services.
- **Recommended fix:** After reconciliation, validate existing nonnegative constraints and add enumerated/check constraints for states/types, quantity scale/domain, movement continuity, and source uniqueness. Retain service validation for clearer errors.

### INV-011 — Central stock mutation prevents overselling and lost updates

- **Severity:** Medium
- **Status:** PASS
- **Classification:** Verified from implementation; unit/contract tests passed
- **Feature:** Negative-stock prevention, multi-cashier concurrency, and movement atomicity
- **Locations and functions:**
  - `server/services/stockService.js:92-272`, `applyStockMovement`
  - `server/services/invoiceService.js:487-618`, `findStockShortfalls` / `confirmInvoice`
  - `server/db/migrations/047_financial_constraints.sql:18-24`, constraint-install block
  - `server/tests/unit/stockService.test.js`, stock-service unit suite
  - `server/tests/contracts/concurrency.locks.test.js`, concurrency contract suite
- **Expected behavior:** Concurrent deductions serialize; stock is re-read while locked; insufficient stock rolls back both balance and movement.
- **Actual behavior:** The service locks the variant row, calculates against locked balances, refuses negative stock/quarantine, updates balance, inserts the movement, and joins an outer transaction when supplied. Invoice confirmation locks all relevant variants before deductions. PostgreSQL also rejects new negative balance writes.
- **Evidence:** `SELECT ... FOR UPDATE` is at `stockService.js:121-128`; insufficient checks at lines 149-188; balance update and movement insert at lines 196-235; transaction ownership at lines 270-272. Invoice confirmation locks stock at `invoiceService.js:487-518` and mutates in the same invoice transaction at lines 532-618. Test result: stock unit suite 12/12 passed and concurrency contract suite 8/8 passed.
- **Safe reproduction:** Run `npx vitest run tests/unit/stockService.test.js tests/contracts/concurrency.locks.test.js` from `server`. For a full proof, run the opt-in live concurrency suite only against a disposable database.
- **Root cause:** PASS — centralized transactional stock mutation with pessimistic row locking.
- **Recommended fix:** Preserve this single mutation path; add live two-session oversell tests to CI and validate the existing `NOT VALID` nonnegative constraints after reconciliation.

### INV-012 — Sales, cancellations, and customer returns couple stock to financial state

- **Severity:** Medium
- **Status:** PASS
- **Classification:** Verified statically; database integration tests unavailable
- **Feature:** Sale deductions, return adjustments, rollback, and partial failures
- **Locations and functions:**
  - `server/services/invoiceService.js:521-618`, `confirmInvoice`
  - `server/services/invoiceService.js:675-705`, `confirmInvoice`
  - `server/services/invoiceService.js:887-956`, `cancelInvoice`
  - `server/services/returnService.js:760-968`, `approveAndExecute`
- **Expected behavior:** Invoice/return state, stock movements, customer/treasury effects, COGS, and journal entries commit or roll back together; sockets fire only after commit.
- **Actual behavior:** Confirmation locks the invoice and variants and applies stock before posting financial entries in one transaction. Cancellation restores stock in its transaction. Return execution locks its source records and applies return/quarantine movements within its transaction; deferred events are emitted only after success.
- **Evidence:** `confirmInvoice` begins `withTransaction` at line 533 and calls the shared engine with its client at lines 586-602; sale journal posting follows at lines 691-705. Cancellation starts its transaction at line 891 and restores stock at lines 921-955. Source review of `returnService.approveAndExecute` showed the same-client movement/accounting sequence and post-commit event emission.
- **Safe reproduction:** In a disposable database, force a journal insert failure after a stock movement during confirmation/return and verify no invoice-state or stock change remains. Integration suites exist but were skipped in this environment.
- **Root cause:** PASS — transaction client propagation and post-commit notification design.
- **Recommended fix:** Keep integration failure-injection tests mandatory in CI; correct FIFO independently because atomic posting can still atomically post the wrong cost.

### INV-013 — Purchase receiving and supplier returns are atomic and retry-safe

- **Severity:** Medium
- **Status:** PASS
- **Classification:** Verified statically; database integration tests unavailable
- **Feature:** Receiving synchronization, duplicate movements, supplier returns, and accounting
- **Locations and functions:**
  - `server/services/purchaseOrderService.js:102-335`, `receiveItems`
  - `server/controllers/purchaseOrdersController.js:609-657`, `receive`
  - `web/services/purchaseOrderService.ts:75-77`, `receivePurchaseOrderItems`
  - `server/controllers/supplierReturnsController.js:196-330`, `create`
  - `server/db/migrations/040_operations.sql:12-20`, `operations` DDL
- **Expected behavior:** Concurrent/duplicate receipts cannot exceed the order or duplicate stock; stock, PO totals/status, history, VAT, journal, and audit commit together. Supplier return stock/accounting is also retry-safe.
- **Actual behavior:** Receiving locks the PO and each item, enforces the remaining quantity, applies stock through the shared engine, posts VAT/journal/audit, and protects the transaction with a unique `(scope,key)` operation. The API requires the key and the frontend sends it. Supplier return creation likewise wraps header, lines, stock, journal, and idempotency in one transaction.
- **Evidence:** PO/item locks and cap checks are at `purchaseOrderService.js:111-169`; stock/history/cost/status/journal at lines 171-316; `runOnce` at lines 324-335. Controller key requirement is `purchaseOrdersController.js:615-620`. Supplier return uses `runOnce` and one transaction at `supplierReturnsController.js:200-293`.
- **Safe reproduction:** Against a disposable database, concurrently submit the same receipt key twice and two different keys that together exceed the remaining PO quantity. Expect one replay for the duplicate and a conflict for over-receipt, with a single consistent stock/journal result.
- **Root cause:** PASS — row locking, transaction boundaries, and durable idempotency records.
- **Recommended fix:** Keep the receipt integration/idempotency suites enabled in CI; add a mandatory-key policy to supplier returns as receipts already have.

### INV-014 — Socket.io stock synchronization is authenticated and self-heals after disconnect

- **Severity:** Medium
- **Status:** PASS
- **Classification:** Verified from server and frontend implementation; no live socket session executed
- **Feature:** Real-time inventory synchronization and network recovery
- **Locations and functions:**
  - `server/socket/index.js:14-72`, `attachSocket`
  - `server/controllers/purchaseOrdersController.js:622-646`, `receive`
  - `web/store/socketStore.ts:118-149,182-189`, `connect`
  - `web/services/stockCacheService.ts:42-110`, `fullSync` / `syncOnReconnect` / `handleStockUpdate`
  - `web/app/(dashboard)/pos/page.tsx:216-227`, POS stock-update effect
- **Expected behavior:** Only valid sessions receive events; committed mutations refresh local stock; missed events during disconnect are repaired from the authoritative API.
- **Actual behavior:** Socket handshake verifies JWT and live session. Writers reviewed emit after commit. Single-variant events update the cache; bulk events trigger full sync; reconnect performs paginated full sync; the POS refetches products on stock events.
- **Evidence:** Server authentication/session lookup is at `server/socket/index.js:37-71`. Reconnect sync is at `socketStore.ts:136-148`; event dispatch at lines 182-189. `stockCacheService.ts:42-86` clears and repopulates the cache from `/stock/summary`; lines 89-110 handle individual and bulk events.
- **Safe reproduction:** In a non-production environment, disconnect one client, complete a stock mutation from another, reconnect, and compare cache/POS stock with `/stock/summary`.
- **Root cause:** PASS — event hints are backed by authoritative resynchronization instead of treated as a durable event log.
- **Recommended fix:** Add an automated reconnect test and observable retry/error telemetry; continue emitting only after transaction commit.

### INV-015 — End-to-end PostgreSQL behavior and existing-data consistency were not tested

- **Severity:** Medium
- **Status:** NOT TESTED
- **Classification:** Explicit test limitation, not a verified vulnerability
- **Feature:** Runtime constraints, deadlocks, rollback, migration state, and inventory/ledger reconciliation
- **Locations and functions:**
  - `server/tests/contracts/concurrency.live.test.js`, live concurrency suite
  - `server/tests/integration/stockCountRebase.test.js`, stock-count rebase suite
  - `server/tests/integration/purchaseOrders.test.js`, purchase suite
  - `server/tests/integration/idempotency.test.js`, idempotency suite
  - `server/tests/integration/dbConstraints.test.js`, constraint suite
- **Expected behavior:** A disposable PostgreSQL instance proves actual migrations, row-lock interleavings, transaction rollback, idempotency, and reconciliation queries.
- **Actual behavior:** Nine integration/live files (75 tests) were skipped because `INVOICE_TEST_PG_PORT` was not configured. Per the read-only rule, no production/development database was inspected or mutated. Therefore migration application state, historical constraint validity, current orphan/duplicate records, and real deadlock behavior remain unknown.
- **Evidence:** Vitest completed successfully with 20 passed and 75 skipped in the selected server run. The runnable tests were unit/contract tests; skipped suites explicitly require the opt-in disposable database.
- **Safe reproduction:** Provision an empty disposable PostgreSQL instance, point only the documented test port variable at it, apply migrations, and run the listed integration suites. Separately run read-only reconciliation queries against a sanitized snapshot, not production, for balance-versus-movement and stock-versus-ledger comparisons.
- **Root cause:** The audit environment did not expose an approved disposable PostgreSQL target.
- **Recommended fix:** Make an ephemeral PostgreSQL service part of CI and fail CI when integration suites silently skip. Add read-only reconciliation tests for `stock_qty` versus movement history, movement value versus journal entries, PO received quantity versus purchase movements, and invoice/return quantity versus movements.

## Test coverage

### Executed safely

From `server`:

```text
npx vitest run tests/unit/stockService.test.js tests/contracts/concurrency.locks.test.js tests/contracts/concurrency.live.test.js tests/integration/stockCountRebase.test.js tests/integration/purchaseOrders.test.js tests/integration/purchaseVat.test.js tests/integration/idempotency.test.js tests/integration/invoiceIntegrity.test.js tests/integration/dbConstraints.test.js tests/integration/customInvoiceItems.test.js tests/integration/auditPhase2.test.js

Result: 20 passed, 75 skipped, 0 failed.
Passed: stockService unit tests (12); concurrency lock contract tests (8).
Skipped: nine PostgreSQL-backed/live files because the disposable DB opt-in was unavailable.
```

From the repository root:

```text
npm --prefix web test -- --run lib/pos/stockGuard.test.ts lib/mobile/mobile.test.ts components/cashier/CashierTerminal.test.tsx components/mobile/MobileApp.test.tsx lib/purchases/newPoMessage.test.ts

Result: 107 passed, 0 skipped, 0 failed across 5 files.
Note: MobileApp emitted React act() warnings; they did not fail tests and did not demonstrate an inventory-integrity defect.
```

### Not executed

- Any test requiring production or development data.
- Any mutation against a non-disposable database.
- Live Socket.io multi-client sessions.
- Failure injection into a real PostgreSQL transaction.
- Existing-data reconciliation or `VALIDATE CONSTRAINT` operations.
- External barcode hardware/scanner tests.

## Inventory consistency risks

| Risk | Quantity impact | Financial impact | Detection difficulty |
|---|---|---|---|
| Latest-cost valuation in place of FIFO | Quantity remains correct | Potentially material inventory and COGS misstatement | High without layer reconciliation |
| Approval/rejection race | Movement applied although record says rejected | Inventory/journal may conflict with workflow evidence | High; requires concurrent timing |
| Barcode collision | Wrong variant can be sold/deducted | Wrong SKU margin, tax/report attribution, and stock | Medium; appears as operator/scanner error |
| Silent quantity rounding | Small movements can be altered or erased | Quantity and movement/value drift | High for fractional-unit products |
| Concurrent stock counts | Conflicting corrections/snapshots | Duplicate or misleading count adjustments | Medium |
| Stale reorder alerts | No immediate balance corruption | Stockout/over-order operational cost | Medium |
| Mutable movement valuation | No quantity impact | Historical report no longer reconciles to journal | High after cost changes |
| Non-idempotent product/variant create | Duplicate records/opening balances | Inflated inventory value and fragmented sales history | Medium |

## Prioritized remediation plan

1. **P0 — Establish a cost-layer design before relying on inventory valuation.** Choose and document FIFO as the accounting policy; add receipt layers, transactional depletion, immutable allocations, and reconciliation/migration tooling. Do not attempt to correct financial history by merely changing `cost_price`.
2. **P0 — Close approval/rejection races.** Make every terminal workflow transition row-locked and conditional in one transaction; add deterministic two-session tests for both adjustments and counts.
3. **P0 — Enforce one global barcode namespace.** Inventory all existing collisions, resolve them, then migrate to a unique barcode table and deterministic lookup.
4. **P1 — Unify the quantity domain.** Define scale by sold-by unit, reject excess precision at every API boundary, align PostgreSQL scale, and test fractional and integer products.
5. **P1 — Enforce count isolation.** Add a database/advisory locking strategy for count creation and variant coverage; make adjustment exclusion transactional.
6. **P1 — Make historical movement valuation immutable.** Persist movement costs/layer allocations and reconcile movement reports to journal entries.
7. **P1 — Expand idempotency.** Protect product/variant creates with opening stock, stock-count creation/submission/approval, and any remaining stock-affecting command; require keys where duplicates have financial effect.
8. **P2 — Make alerts durable.** Reconcile on threshold edits, queue post-commit checks in an outbox, retry failures, and schedule a periodic full reconciliation.
9. **P2 — Decide the transfer requirement.** Implement location balances and atomic transfers if Bytecra is multi-location; otherwise explicitly declare the single-location invariant.
10. **P2 — Strengthen and validate PostgreSQL constraints.** Reconcile existing rows, validate `NOT VALID` constraints, add state/type/continuity/domain checks, and enable the disposable PostgreSQL suites as required CI tests.

## Audit conclusion

Bytecra POS has a sound centralized mechanism for atomic quantity changes and several well-designed retry protections, but its financial cost model is not FIFO and cannot produce FIFO-accurate valuation or COGS. The approval-state races and barcode ambiguity can also create records that look internally legitimate while pointing to the wrong workflow outcome or product. These three High findings should be treated as release-blocking for environments that rely on inventory valuation, concurrent approvals, or barcode scanning. The PASS results should not be interpreted as end-to-end production certification until the skipped PostgreSQL and live concurrency suites run against a disposable database and historical data is reconciled.
