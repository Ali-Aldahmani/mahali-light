# EDARA POS — Warranty Management & Product Traceability Audit

**Audit date:** 24 October 2026 (Asia/Dubai)  
**Repository:** D:\Projects\mahali-light  
**Revision inspected:** 0ff97898a233ef6fa5c06b050c00f3e559ecc2df  
**Scope:** Read-only source audit plus isolated, database-free execution of source functions. The repository identifies itself as Bytecra POS / mahali-light; this report uses the requested EDARA title.

**Snapshot and concurrent-work qualification:** The working tree was clean at the initial status check. Independent changes appeared during this audit in customer controllers/services/UI, invoiceService, returnService and activityLog, plus a new 038_customer_audit_integrity.sql migration and related files. This auditor changed none of those files. Unless explicitly marked “concurrent working-tree change,” source line citations refer to revision 0ff97898a233ef6fa5c06b050c00f3e559ecc2df and the initial inspected source, not shifted line numbers in those later edits. Final diff review confirmed that invoice/return changes add customer event notifications without fixing the warranty integration defects. The new activity-log transaction option, actor snapshot and append-only trigger are acknowledged in F22; their deployment was not tested. The customer warranty-list body remains unchanged but now begins at line 947 rather than 756. This is an audit of the stated snapshot with a scoped review of overlapping later changes, not certification of an arbitrarily changing workspace.

## 1. Executive Summary

**Verdict: PARTIAL implementation; not ready for dependable end-to-end production warranty management.** There are real Next.js screens, Express routes, PostgreSQL records, expiry jobs, and repair/replacement claim services. This is substantially more than a UI placeholder. However, the complete lifecycle is broken at several important boundaries.

The most consequential defects are:

- Sale confirmation commits before warranty registration; warranty failures are swallowed. A paid sale can permanently lack its warranty.
- Serial numbers are text on sale lines and warranty records, not tracked inventory units. Two sales can commit with the same serial; a later warranty uniqueness failure does not reverse either sale.
- Returning one unit from a three-unit sale line voids the entire line warranty. Ordinary return/exchange replacements get no warranty.
- Duplicate open claims are accepted; replaced warranties remain claimable; resolving an existing claim does not recheck whether the warranty was voided/refunded.
- Invoice pages request an invoice filter that the backend ignores, displaying unrelated warranties.
- Manual-registration and replacement UI selectors expect product objects, but their API returns variant objects.
- Cashier defaults include the permission used for arbitrary warranty edits and voiding.
- Warranty history and audit events are incomplete; reports count records/claims rather than consistently measuring covered or defective units.

**What was executed:** Three standalone Node scripts, supplied through standard input, completed **57 assertions** against actual source functions using synthetic objects, strict import allowlists, mocked query functions, and fixed clocks where needed. Assertions include both correct behavior and deliberate confirmation of defects. They are **not 57 passing business scenarios**. No PostgreSQL query, HTTP request to the application, real sale, payment, return, claim, migration, installation, container operation, or restore was executed.

**What was not executed:** Browser workflows, real HTTP authentication, PostgreSQL constraints/locking, payment or stock integration, live-data integrity scans, restart/failure injection, load tests, and backup/restore. No approved isolated database was established. The normal test configuration can probe localhost and integration suites can create databases; these were inspected and deliberately not run. Production data and secrets were not read.

**Verification vocabulary used throughout:**

| Status | Meaning here |
|---|---|
| PASS | Actual database-free behavior tested successfully, limited to the stated assertion |
| FAIL | Confirmed defect, with either source evidence or an executed isolated reproduction |
| PARTIAL | Some implementation exists, but coverage or integration is incomplete |
| NOT TESTED | Execution could not be performed within the approved safe environment |
| NOT IMPLEMENTED | No implementation found in the inspected runtime source/schema for the stated capability |
| NOT APPLICABLE | Not required for this architecture, such as mandatory serialization of ordinary bulk goods |

Code-inspected safeguards are explicitly described as inspected, not marked PASS. Severity measures business impact; P0 is a production blocker, P1 high priority before warranty reliance, P2 the next hardening/feature tranche. Finding IDs below carry their complete severity, source, root cause, evidence, impact, recommendation, and priority; later tables refer to those same findings.

## 2. Warranty Architecture

The deployed architecture in source is **Next.js/React → Express/Node → PostgreSQL 16**. The optional FastAPI profile provides ML functionality, not a separate warranty engine. Sources: package.json:1, docker-compose.yml:10, docker-compose.yml:38, docker-compose.yml:95, server/index.js:341, server/db/postgres.js:6.

| Layer | Entry / responsibility | Evidence |
|---|---|---|
| Product configuration | Product default duration in whole months; serial requirement at category level | server/controllers/productsController.js:34; server/db/migrations/002_products.sql:8,49 |
| Inventory | Aggregate variant stock and quarantine quantities; PO quantity receipts | server/db/migrations/002_products.sql:57; server/services/purchaseOrderService.js:102 |
| Checkout UI | Draft → payment allocations → confirm; a serial string per cart line | web/lib/pos/checkout.ts:114; web/store/posStore.ts:290 |
| Sale transaction | Locks invoice and variants; checks payment allocation and required serial presence; posts stock/treasury | server/services/invoiceService.js:509 |
| Warranty registration | Separate post-commit transaction, one record per eligible invoice item | server/services/invoiceService.js:806; server/services/warrantyService.js:101 |
| Warranty APIs | List, summary, lookup, product stats, detail, manual create, update, void | server/routes/warranties.js:7 |
| Claim APIs | Create, detail, edit, resolve, supplier raised/resolved flags | server/routes/warrantyClaims.js:7 |
| Persistence | warranties, warranty_claims, invoice_items.serial_number, activity_log | server/db/migrations/008_warranties.sql:3,29,67 |
| Returns | Return approval voids active warranties by invoice item; separate replacement builder | server/services/returnService.js:972,1132,1268 |
| Expiry | Initial sweep after 30 seconds; 24-hour interval; notifications | server/jobs/warrantyExpiry.js:39; server/jobs/notificationCron.js:48 |
| Reports | Active warranties, claims, product claim rate | server/services/reportService.js:1570,1607,1645 |
| Backup | Whole PostgreSQL custom-format dump | server/backup/strategies/dbBackup.js:38 |

Lifecycle map:

    Product months / category serial flag
       → PO receipt → variant quantity stock
       → cart line (quantity + one optional serial)
       → draft + payment allocations
       → sale / stock / financial COMMIT
       → separate warranty transaction [failure only logged]
       → invoice/customer lookup
       → claim open → in_progress → repaired / replaced / rejected
                                └→ supplier boolean flags
       → return approval [whole invoice-item warranty void]
       → ordinary exchange invoice [no warranty registration]

There is no separate warranty repository layer: controllers and warrantyService issue SQL directly. There is no physical-unit registry, receipt-to-unit allocation, or warranty policy version entity.

## 3. Frontend Findings

**F01 — Manual registration and replacement selectors use the wrong API contract.**  
**Severity:** High · **Status:** FAIL (code inspection) · **Priority:** P1  
**File/lines:** web/components/warranties/WarrantyFormSlideOver.tsx:62–69,120–128; web/components/warranties/ResolveClaimSlideOver.tsx:41–52,71–80; web/services/productService.ts:65; server/controllers/productsController.js:688–719.  
**Root cause/evidence:** searchProducts returns flat entries with productId, productName, variantId, sku, stockQty. Manual registration reads p.id, p.name, p.variants; replacement searches p.id === claim.productId and then p.variants. Those properties are absent. The replacement dropdown stays empty and submit requires variantId; manual options do not have valid product values. Empty-query searches are also limited to 25/50 recent variants.  
**Business impact:** A real API implementation exists, but staff cannot reliably register warranties manually or issue replacements through these screens. This also undermines the suggested manual recovery from failed auto-registration.  
**Recommended fix:** Use the product detail/variants endpoints or explicitly group the flat search contract; provide searchable pagination and test the actual response shape.

**F02 — Manual UI cannot capture the provenance that its subtitle promises.**  
**Severity:** Medium · **Status:** PARTIAL · **Priority:** P1  
**File/lines:** web/components/warranties/WarrantyFormSlideOver.tsx:120–128,148; server/controllers/warrantiesController.js:197–209.  
**Root cause/evidence:** The API accepts invoiceId, invoiceItemId, supplierId and purchaseOrderId, but the form sends none. It offers “supplier” type without supplier/PO selection.  
**Business impact:** Even after F01 is fixed, manually registered records are not connected to a receipt or supplier source through this UI.  
**Recommended fix:** Capture and validate provenance for the selected coverage type, with an explicit authorized legacy-registration exception.

Other inspected UI wiring is real: list/lookup/detail pages use the warranty services; claims have detail and resolution screens; product edit exposes default months; customer profiles include warranty cards. No complete extension/history editor or dedicated warranty-document download was found. Lookup exposes a claim button with only page-level warranty.view gating (web/app/(dashboard)/warranties/lookup/page.tsx:96–99,135); backend warranty.claim still governs submission. This is a UI permission inconsistency, not proof of an unauthenticated write bypass.

## 4. Backend Findings

**F03 — Manual warranty creation trusts unrelated object IDs and lacks sale eligibility checks.**  
**Severity:** High · **Status:** FAIL (code inspection) · **Priority:** P1  
**File/lines:** server/controllers/warrantiesController.js:197–209; server/services/warrantyService.js:216–276; server/db/migrations/008_warranties.sql:6–12.  
**Root cause/evidence:** UUID syntax and independent foreign keys do not establish that a variant belongs to the product, an invoice item belongs to the invoice/product, the invoice is finalized, or the customer matches the buyer. The service checks positive duration/product/start, then serial uniqueness and inserts supplied IDs. It allows no invoice at all.  
**Business impact:** An authorized creator can attach coverage to the wrong purchase/customer/product or create sale-backed-looking coverage for an unfinalized sale.  
**Recommended fix:** Resolve associations from an authoritative invoice-item or received-unit reference, verify finalized eligibility and ownership, and separate approved manual/legacy exceptions with reasons.

**F04 — Warranty dates/duration can become contradictory; extension does not reactivate expired coverage.**  
**Severity:** High · **Status:** FAIL (executed source/controller checks H1/H2/H3) · **Priority:** P1  
**File/lines:** server/controllers/warrantiesController.js:236–276; server/services/warrantyService.js:29–39,421.  
**Root cause/evidence:** startDate/endDate need only eight characters; updates independently write dates and duration without ordering, recomputation, or state transition. H1 changed durationMonths to 24 and captured UPDATE without end_date. H2 sent endDate before startDate and captured the update. H3 proved status=expired still rejects a claim after the end date is extended. addMonthsDate normalizes impossible February 30 to April 2 when adding one month rather than rejecting it. PostgreSQL may reject invalid DATE literals, but that is not API validation and does not reject a valid yet inverted date range.  
**Business impact:** Stated duration, displayed expiry, and actual claim eligibility disagree.  
**Recommended fix:** Validate calendar dates strictly; introduce an explicit extension action, derive consistent dates, record reason/actor and policy version, and recompute effective eligibility.

Product creation does validate defaultWarrantyMonths as integer 0–120; H2 actually accepted 0/12 and rejected -1/1.5/121. Product updates use the schema and persist months. Manual warranty creation validates integer duration 1–600. These bounds differ and should be deliberate. Product configuration supports no separate brand/supplier/manufacturer policy or terms/exclusions fields. Product permissions apply through server/routes/products.js:20–24.

Product-configuration coverage, explicitly addressing the requested checks:

| Check | Assessment |
|---|---|
| Product can have coverage / disable it | Yes in source: defaultWarrantyMonths >0 enables auto-creation; 0 disables it. H2 exercised this branch. |
| Configurable duration and different products | Whole months per product, 0–120; separate manual records allow 1–600. |
| Days, months, years | Months supported; years expressible as 12n months; fixed-day unit absent. |
| Brand/supplier/product terms | Product-specific months only; generic terms on manual records; no inherited brand/supplier policy. |
| Store/manufacturer/supplier provider | Customer/supplier type plus optional supplier ID; no complete provider model. |
| Terms and exclusions | One optional terms text on coverage; no product policy/exclusion snapshot on automatic sale. |
| Multiple coverage types per product | Manual customer/supplier rows possible, but active same-serial layers conflict (F19); no structured component/multi-policy configuration. |
| Duration editable after creation | Product default and warranty duration have edit APIs; warranty edit consistency is defective (F04). |
| Effect on already-sold items | Already-created duration/date snapshots stay unchanged; delayed registration uses current default (F13). |
| Historical terms | Not preserved by automatic registration; terms are null (F13). |
| Backend validation / invalid durations | Product schema checks exercised; direct database constraints are incomplete (F05). |
| Persist after restart | Stored in PostgreSQL; restart persistence NOT TESTED. |

## 5. Database Schema Findings

**F05 — Foreign keys exist, but semantic and quantity invariants are missing.**  
**Severity:** High · **Status:** PARTIAL (schema inspection) · **Priority:** P1  
**File/lines:** server/db/migrations/008_warranties.sql:3–48,73–75; server/db/migrations/002_products.sql:49; server/db/migrations/006_invoices.sql:1.  
**Root cause/evidence:** Warranty/claim numbers are unique; references are foreign keys. There are no warranty CHECK constraints for valid status/type, positive duration, date order or terminal-claim consistency; warranty_id on claims is nullable. There is no covered quantity, unit identity, uniqueness of coverage per invoice item, or partial uniqueness of open claims. The active serial unique index is discussed in F07/F16. Later migrations inspected do not add these invariants.  
**Business impact:** Direct SQL/import bugs or incomplete service validation can produce semantically invalid records even when every foreign key is satisfied.  
**Recommended fix:** Add narrowly scoped checks and relationship constraints after an integrity assessment; define quantity/unit policy first. Require non-null primary claim linkage.

The index inventory is useful: warranty customer/product/invoice/serial/status/end_date/invoice_item/supplier/type and claim warranty/status/customer/date are indexed. Only warranty/claim numbers and the partial active product+serial combination are unique. Deployed schema and actual orphan/duplicate counts are **NOT TESTED**; migration text is not evidence that production has applied it.

## 6. Product & Serial Traceability

**F06 — Warranties are per sale line, not per physical unit; quantity is not represented.**  
**Severity:** Critical · **Status:** FAIL (source inspection; H2 confirms quantity-three creates one record) · **Priority:** P0  
**File/lines:** server/services/warrantyService.js:119–185; web/store/posStore.ts:290–325; server/controllers/invoicesController.js:368–372; server/services/invoiceService.js:447–461; server/db/migrations/004_suppliers.sql:40–50.  
**Root cause/evidence:** The cart merges identical variant IDs and keeps one serial string. Backend validation checks serial presence only when the product category requires it. Quantity remains a positive number, with no serialized-line quantity=1 invariant. Auto-registration loops invoice items, not units, and stores no quantity. PO receipts and stock movements carry aggregate quantity without unit serial allocation.  
**Business impact:** Two same-SKU physical units cannot be reliably distinguished end-to-end; multi-unit service, ownership and partial-return entitlements are ambiguous. Even serial-required products can have one serial for several units through the API.  
**Recommended fix:** For serialized categories, register received units, assign one unit per sale allocation, and enforce inventory state atomically. For ordinary nonserialized goods, keep sale-line quantity coverage and decrement/transfer only the affected quantity. Do not mandate serials for all products.

**F07 — The serial guard protects active warranty rows, not sales or lifetime unit identity.**  
**Severity:** Critical · **Status:** FAIL (code/schema inspection) · **Priority:** P0  
**File/lines:** server/services/warrantyService.js:72–93; server/db/migrations/008_warranties.sql:67–75; server/services/invoiceService.js:544,806–821; web/components/ui/SerialNumberInput.tsx:43–75.  
**Root cause/evidence:** The unique index is only (product_id, serial_number) WHERE status='active'. Invoice serial index is nonunique. Sale confirmation checks presence, not reservation/exclusive ownership; its warranty check runs after commit. Frontend lookup uses a capped fuzzy query and fails open on request failure. Serial text has no canonical identity validation; manual/update paths do not normalize whitespace consistently. Expired/claimed/void warranty states release the active-row uniqueness guard.  
**Business impact:** One physical serial can appear on two completed sales, particularly concurrent/offline-retry cases. The second warranty may fail while the sale stays committed; older sold units can be sold again once warranty status changes.  
**Recommended fix:** Enforce saleable-unit state independently of warranty expiry, normalize identifiers with a documented product/manufacturer scope, and reserve/transfer units in the sale transaction. Keep the warranty index as a secondary coverage constraint.

| Identifier/capability | Inspected implementation |
|---|---|
| Product ID | UUID product relationship |
| SKU | Unique variant SKU (002_products.sql:60) |
| Barcode | Variant barcode/internal/supplier barcode; internal barcode unique; not proof of unit identity |
| Serial | Free text on invoice/warranty/return rows; active coverage uniqueness only |
| IMEI | UI placeholder says “Serial / IMEI”; no dedicated IMEI/check-digit validation found |
| Batch/lot | No receipt-to-sale lot entity/allocation found in runtime migrations |
| Serial search | Warranty lookup and invoice return lookup exist |
| Supplier → unit → customer | NOT IMPLEMENTED as a continuous unit chain |
| Ownership history | Invoice/customer references and editable customer field; no immutable ownership-transfer ledger |
| Mandatory serialization of bulk products | NOT APPLICABLE; selective tracking is appropriate |

## 7. Checkout Integration

**F08 — Sale, stock and warranty registration are not atomic.**  
**Severity:** Critical · **Status:** FAIL (direct code evidence) · **Priority:** P0  
**File/lines:** server/services/invoiceService.js:509–717,806–822; server/services/warrantyService.js:101–107; server/db/postgres.js:52–64.  
**Root cause/evidence:** confirmInvoice completes withTransaction, then calls createWarrantiesFromInvoice in a new transaction. Every error is caught and logged, and result.warranties becomes an empty array. No durable retry/outbox/reconciliation task was found. If the second eligible item fails, that separate warranty transaction rolls back all warranty rows for the sale while the sale stays committed.  
**Business impact:** Successful sales silently lose coverage; a backend crash between commits loses registration; duplicate-serial conflicts are invisible as checkout failure.  
**Recommended fix:** Accept the sale transaction client in warranty registration and insert coverage before commit, or use a durable transactional outbox with visible pending state and monitored retries. Snapshot policy during the same transaction.

**F09 — Cancellation and warranty generation can race; cancellation cleanup is best effort.**  
**Severity:** Critical · **Status:** FAIL (code inspection; H2 reproduces missing status guard) · **Priority:** P0  
**File/lines:** server/services/invoiceService.js:866,1066–1074; server/services/warrantyService.js:104–114,302–331.  
**Root cause/evidence:** Cancellation commits before separate voiding, whose errors are swallowed. Registration selects an invoice without status, locking or eligibility checks. H2 supplied a cancelled synthetic invoice and registration still inserted coverage. A cancellation can void no rows before the pending registration inserts an active warranty. Voiding by invoice affects active customer warranties only.  
**Business impact:** A cancelled/refunded-away purchase can leave claimable coverage; concurrent requests produce inconsistent rights.  
**Recommended fix:** Serialize sale state, coverage generation and cancellation on the invoice and affected coverage within one transaction; add durable repair for historical discrepancies.

**F10 — Registration and checkout retries are not durably idempotent.**  
**Severity:** High · **Status:** FAIL (concurrency/code inspection; no concurrent DB execution) · **Priority:** P1  
**File/lines:** server/services/warrantyService.js:128–144; server/db/migrations/008_warranties.sql:57,73; server/services/invoiceService.js:511–525; web/lib/pos/checkout.ts:114–139; server/db/migrations/025_invoice_payment_idempotency.sql:2–5.  
**Root cause/evidence:** A pre-read Set skips existing item IDs for sequential calls but has no unique invoice-item coverage constraint. Two calls can both read no coverage before either inserts a nonserialized warranty. Document numbering serializes number allocation, not the earlier eligibility read. Confirming the same invoice twice is stopped by invoice lock/status, but a lost response cannot replay the original successful confirmation result. Payment keys are per invoice; new draft creation is not protected by that index.  
**Business impact:** Duplicate coverage can arise through simultaneous/backfill/manual calls; network retries can strand cashier workflows or create new sales if a fresh draft is used.  
**Recommended fix:** Give the checkout operation and coverage allocation stable idempotency keys and unique constraints; return the prior result on safe replay; expose reconciliation for missing coverage.

Inspected correct boundaries: payment allocations must cover the invoice; customer credit requires a customer and credit-limit checks; invoice and stock operations share a transaction. These represent **internal payment allocation**, not independently verified card-network settlement. A failure thrown inside the main transaction rolls it back before auto-registration is reached. Cancelled drafts/payment failures normally create no automatic coverage. No production payment/fault test was performed.

Successful auto-registration writes the invoice ID, invoice item ID, product/variant, optional customer, serial, date and month snapshot. H2 verifies these fields with synthetic data, including anonymous customer=null. Existing warranty dates/duration do not automatically change when the product's default months change; the vulnerable window is before deferred registration or late manual backfill.

## 8. Warranty Date Accuracy

**F11 — Stored status can be stale; date consistency depends on configured timezone and representation.**  
**Severity:** Medium · **Status:** FAIL (H1/H3 reproduction plus inspection) · **Priority:** P1  
**File/lines:** server/services/warrantyService.js:44–52,421,909–918,958–986; server/jobs/warrantyExpiry.js:9,39–42; web/lib/config.ts:85; server/utils/dates.js:18–39; server/db/postgres.js:18–20.  
**Root cause/evidence:** Expiry status is stored and swept every 24 hours. shapeWarranty returns that status unchanged, while claim creation separately checks end_date. H3 showed an active response with -1 days remaining but claim rejection. daysBetween uses local getters on both Date and ISO string inputs; H1 reproduced an off-by-one in a negative timezone when mixing those representations. Invalid dates return zero days remaining. Backend STORE_TIMEZONE is configurable; frontend TIMEZONE is hardcoded Asia/Dubai.  
**Business impact:** Staff can see “active” for an expired warranty, and status-based reports disagree with claim decisions. Nondefault timezone configurations can display inconsistent dates.  
**Recommended fix:** Derive effective status from one store-calendar-date utility at every read/write boundary, normalize DATE values explicitly, reject invalid input, and share timezone configuration. Keep business transition state distinct from effective expiry.

Executed date results (H1/H3):

| Case | Actual result | Status |
|---|---|---|
| 31 Jan 2026 + 1 month | 28 Feb 2026 | PASS |
| 31 Jan 2024 + 1 month | 29 Feb 2024 | PASS |
| 29 Feb 2024 + 12 / 24 months | 28 Feb 2025 / 28 Feb 2026 | PASS |
| 31 Dec 2026 + 1 month | 31 Jan 2027 | PASS |
| 24 Oct 2026 + 12 / 24 months | 24 Oct 2027 / 24 Oct 2028 | PASS |
| All seven arithmetic cases in Dubai, UTC, Los Angeles | Same date-only results, 21 assertions | PASS |
| Null / invalid text start in helper | null | PASS for helper; API response not tested |
| Impossible 30 Feb 2026 + 1 month | 2 Apr 2026 | FAIL |
| Invalid input to daysBetween | 0 | FAIL |
| Local 31 Jan noon to ISO 1 Feb in Los Angeles | 0 rather than 1 | FAIL |
| Expiry date 24 Oct; Dubai 23:59:59 | Claim permitted | PASS, inclusive end-date convention |
| Next Dubai midnight | Claim rejected | PASS |
| Stored active after end date | Still shaped active; daysRemaining=-1 | FAIL |
| Expired state with newly future end date | Still rejects claim | FAIL, extension behavior |
| 30-day / 90-day fixed durations | No day-unit duration path | NOT IMPLEMENTED |
| Years | No year unit; express 12/24/etc. months | PARTIAL |
| Different client/server physical clocks | No skew simulation against real services | NOT TESTED |

Calendar-month clamping is correctly implemented for valid ISO dates. Do not replace fixed 30/90-day business terms with one/three calendar months: they are not equivalent. Activation is tied to confirmation date, with a created_at fallback; no delivery-date, customer activation, repair downtime extension, or configurable activation rule is implemented. Missing database dates are not safely validated end-to-end. Server boot applies the configured process timezone and the database session uses it; browser date formatting uses Dubai.

## 9. Customer & Invoice Integration

**F12 — Invoice detail shows warranties from other invoices.**  
**Severity:** High · **Status:** FAIL (H1 controller execution with captured SQL) · **Priority:** P1  
**File/lines:** web/app/(dashboard)/invoices/[id]/page.tsx:76–79,801–833; web/services/warrantyService.ts:12–13; server/controllers/warrantiesController.js:34–76.  
**Root cause/evidence:** The page calls listWarranties({invoice_id:id,limit:100}); buildListFilters has no invoice_id clause. H1 confirmed neither query predicates nor query parameters contain the supplied invoice ID.  
**Business impact:** Misattributed coverage/customer information appears within an unrelated invoice and can direct staff to the wrong claim. This is a filtering/association defect; the staff may otherwise have broad warranty-view access.  
**Recommended fix:** Validate/apply invoice_id consistently in data and count queries and add a real API/UI contract test with two invoices.

**F13 — Purchase-time policy and document evidence are incomplete.**  
**Severity:** High · **Status:** PARTIAL · **Priority:** P1  
**File/lines:** server/services/warrantyService.js:119–185; server/db/migrations/008_warranties.sql:15–18; server/services/pdfService.js:160–191,208–229,297–298,415–428; server/templates/invoice.html:276.  
**Root cause/evidence:** Duration/start/end are stored once per warranty, but auto-created terms are explicitly null. Product configuration has no policy version/terms/exclusions/provider snapshot. Warranty product names come from the current product join, not the sale snapshot. Invoice and thermal receipt renderers omit line serials, warranty numbers/durations/end dates and coverage text. Invoice terms come from current store settings. No dedicated warranty certificate endpoint/template was found.  
**Business impact:** Product default changes leave already-created durations intact, but old terms cannot be reconstructed; deferred/backfilled coverage may use a new product duration. A receipt identifies the sale but does not itself document its coverage. Regenerating documents can apply current general terms.  
**Recommended fix:** Freeze the complete effective policy and product/provider identity at finalization; print or attach that snapshot and serial/quantity allocation to the receipt and invoice.

Multiple products, multiple dates, different durations and repeated purchases are supported at the invoice-item relationship level. Customer history is explicitly filtered by customer and includes all statuses (server/controllers/customersController.js:756–784). Invoice/serial lookup exists, but is fuzzy and capped at 20. Anonymous coverage is allowed and H2 confirmed null customer with invoice/item links. Staff can verify it through the receipt's invoice number when registration exists. There is no public customer self-service portal; direct access is authenticated. Long-term retrieval/restart persistence is designed through PostgreSQL, not runtime-tested.

## 10. Returns & Refunds

**F14 — Partial quantity return voids all coverage for the sale line.**  
**Severity:** Critical · **Status:** FAIL (direct SQL/code evidence) · **Priority:** P0  
**File/lines:** server/services/returnService.js:972–985; server/services/warrantyService.js:143–190; server/db/migrations/008_warranties.sql:3–26.  
**Root cause/evidence:** Return approval updates every active warranty WHERE invoice_item_id=$3, without returned quantity or unit allocation. A quantity-three line has only one warranty.  
**Business impact:** Returning one unit removes warranty eligibility for the two units retained by the customer. Different invoice lines are not all voided, which is an important distinction.  
**Recommended fix:** Make returns change only returned unit allocations or covered quantity; preserve remaining entitlement and audit the change in the return transaction.

**F15 — Return/exchange replacement bypasses warranty and serial registration.**  
**Severity:** High · **Status:** NOT IMPLEMENTED for this integration · **Priority:** P0  
**File/lines:** server/services/returnService.js:1132–1150,1268–1440,1351–1357.  
**Root cause/evidence:** The ordinary return service directly constructs a confirmed replacement invoice and deducts stock, inserts serial_number=NULL, and never calls warranty registration. This is a different builder from the warranty-claim replacement path.  
**Business impact:** A replacement/exchange can be a finalized inventory transaction with no new warranty or replacement unit identity.  
**Recommended fix:** Centralize replacement issuance with the same coverage/unit allocation contract as checkout, applying an explicit carry-forward/restart policy.

Actual rules inspected:

| Scenario | Current behavior / limitation |
|---|---|
| Full refund through return approval | Active warranties on returned invoice lines void; no explicit expired/claimed handling |
| One line from multi-line sale | That line's active coverage void; other line IDs unaffected |
| One unit of three | Entire line warranty void (F14) |
| Sale cancellation | Separate best-effort invoice warranty void after commit (F09) |
| Refund bookkeeping fails | Return transaction should roll back stock/void/refund changes together; DB execution NOT TESTED |
| Good returned item | Restocked; warranty is still voided |
| Defective/damaged item | Normally quarantined via stockActionFor; warranty is still voided |
| Warranty replacement | Separate claim service: old marked claimed, new coverage created, with F18 defects |
| Ordinary replacement/different product exchange | New confirmed invoice, NULL serial, no warranty (F15) |
| Credit refund | Reduces an existing customer credit debt; not a general store-credit voucher system (returnService.js:1051–1063) |
| Refund reversal | No approved-return reversal/warranty-restoration API found; only pending request cancellation (returnService.js:1530; routes/returnOrders.js:9–11) |
| Suspended/transferred coverage | No corresponding state/workflow |
| Existing open claim on returned item | Not cancelled/blocked by return approval; resolution gap F17 |

There is no basis to assume all returns should void all warranties. The quantity, condition, replacement and refund rights need an explicit policy.

## 11. Warranty Claims

**F16 — Duplicate active claims and invalid claimant/activation states are accepted.**  
**Severity:** Critical · **Status:** FAIL (H1 source execution plus schema inspection) · **Priority:** P0  
**File/lines:** server/services/warrantyService.js:400–447; server/db/migrations/008_warranties.sql:29–48; server/controllers/warrantyClaimsController.js:129–133.  
**Root cause/evidence:** createClaim locks the warranty, but never checks for another open/in_progress claim. It accepts status='claimed', does not check start_date, and permits supplied customerId to override the warranty customer. H1 created two open synthetic claims, accepted a claim on a future-start warranty, preserved a mismatched customer and accepted another claim on a claimed warranty.  
**Business impact:** Repeated claims against one unit can yield duplicate replacements; claimed replacement history is not terminal; customer association and eligibility can be fabricated by an authorized processor.  
**Recommended fix:** Validate effective eligibility and claimant association, distinguish historical claims from one conflicting open claim per unit/coverage allocation, and enforce this with both locking and a database constraint. Allow intentional multiple-unit claims only with explicit allocations.

**F17 — Resolution does not revalidate entitlement, and claim editing races with closure.**  
**Severity:** Critical · **Status:** FAIL (code inspection) · **Priority:** P0  
**File/lines:** server/services/warrantyService.js:620–643,649–709; server/controllers/warrantyClaimsController.js:169–206.  
**Root cause/evidence:** Resolve locks the joined claim/warranty but selects no warranty status/end date and checks only whether that claim is already resolved/rejected. A refund or manual void after claim creation does not block replacement. Separate claims against the same warranty can both resolve sequentially. PUT reads status outside a transaction, then updates by ID alone; a delayed PUT can set in_progress after another request closes the claim.  
**Business impact:** Stock can be issued for already-refunded coverage; terminal records can be reopened with old resolution fields retained.  
**Recommended fix:** Recheck entitlement and return state under common locks; define treatment of claims valid at submission but expiring during repair; update statuses with compare-and-swap/version conditions and transactional event logging.

**F18 — Claim replacement loses serial identity and can mix two products.**  
**Severity:** High · **Status:** FAIL (code inspection) · **Priority:** P0  
**File/lines:** server/services/warrantyService.js:501–516,560–582,650–677,712–737; server/services/stockService.js:123–140,218–223; server/controllers/warrantyClaimsController.js:232–236.  
**Root cause/evidence:** replacementVariantId is an arbitrary valid UUID. The replacement invoice uses the selected variant's product, while the stock call/new warranty use the old warranty productId. Stock service trusts paramProductId. There is no equality check. Both new invoice serial and new warranty serial are null; the resolver accepts no replacement serial. It restarts the full original month duration, uses generic replacement terms and carries old supplier/PO IDs.  
**Business impact:** API-driven different-product replacements can create contradictory product/variant inventory and warranty relationships. Required-serial replacement units are untraceable. Original policy and replacement sourcing may be wrong.  
**Recommended fix:** Validate allowed replacement product/variant or support an explicit cross-product policy; derive product from the selected unit, record serial and receipt provenance, and establish the renewed/carry-forward coverage terms. Record the old/new coverage relation in structured data.

Implemented claim capabilities: reference number, defect description, submission date, open/in_progress/resolved/rejected statuses, repair marker, replacement invoice, rejection reason, history list, actor on closure, internal staff notifications. H1 verifies rejection of void/expired warranties; H2 verifies the pure transition helper rejects backward/terminal transitions. These do not certify the database workflows.

Missing/partial capabilities: separate approval gate, repair work order/parts/labor/service dates, cost ledger/recovery, defect category, attachments/intake proof, actual customer communication, duplicate conflict protection, and a dedicated refund resolution. “Repaired” merely closes the claim and leaves the warranty unchanged; no repair-downtime extension occurs. Replacement inventory deduction and warranty/claim changes share one transaction, which is a useful inspected property. Physical handling of the original defective unit and its service/quarantine chain are not modeled in that replacement flow.

## 12. Supplier & Manufacturer Integration

**F19 — Supplier coverage cannot coexist correctly with customer coverage for one active serial.**  
**Severity:** High · **Status:** FAIL / PARTIAL (schema and code inspection) · **Priority:** P1  
**File/lines:** server/db/migrations/008_warranties.sql:73–75; server/services/warrantyService.js:72–93,169–185,843–900; server/controllers/warrantiesController.js:172–183; server/services/purchaseOrderService.js:126–175.  
**Root cause/evidence:** warranty_type distinguishes customer/supplier, but uniqueness and assertSerialUnique do not include type/provider. An active supplier warranty for product+serial blocks customer registration, which checkout then suppresses (F08). Conversely, a customer record blocks supplier creation. Detail lookup attempts to find both, but auto customer registration never associates supplier/PO. PO receiving does not create unit/supplier coverage. Supplier claims are two editable booleans, with no linked recovery case, outcome amount, dates or state machine; resolved=true can be set without raised=true.  
**Business impact:** Intended coverage layers conflict; supplier recovery and physical provenance cannot be relied on.  
**Recommended fix:** Separate unit identity from multiple coverage layers; capture supplier receipt allocation and use a structured supplier RMA/recovery lifecycle with credit/replacement and cost outcomes.

Supplier and purchase-order entities do exist, with purchase_orders.attachment_path (004_suppliers.sql:34) and supplier_returns records (004_suppliers.sql:80). These can hold purchasing evidence, but the unit-to-originating-invoice link is missing. Manufacturer coverage is not a separate modeled provider/policy. Separate manually supplied terms/durations are possible, subject to the above conflicts. Supplier recovery costs and manufacturer-vs-store policy comparison are NOT IMPLEMENTED as warranty features.

## 13. Security & Permissions

**F20 — Cashier defaults permit arbitrary warranty edits and voiding.**  
**Severity:** High · **Status:** FAIL (executed middleware/default-role check H2; live role state NOT TESTED) · **Priority:** P0  
**File/lines:** shared/permissions.js:178–185; server/routes/warranties.js:17–22; server/db/seed.js:117–119,149; server/controllers/warrantiesController.js:264–269.  
**Root cause/evidence:** Cashier has warranty.create. Create, PUT and void all use that key. The route comment claiming void is manager/admin by default contradicts the defaults. H2 confirmed a user with seeded Cashier permissions passes that guard.  
**Business impact:** Cashiers can extend/shorten dates, change terms/customer/serial or void any reachable warranty; there is no separate extend/void approval permission or mandatory reason. This is a role-design defect, not an unauthenticated bypass.  
**Recommended fix:** Separate create/register, edit terms, extend, transfer, void and claim resolution permissions; validate role defaults and overrides; require reason/audit for sensitive changes.

**F21 — Warranty read restrictions are bypassed through customer history.**  
**Severity:** Medium · **Status:** FAIL (route inspection and H2 permission check) · **Priority:** P1  
**File/lines:** server/routes/customers.js:44–47; server/controllers/customersController.js:756–784; server/routes/warranties.js:9–18.  
**Root cause/evidence:** /customers/:id/warranties needs only customer.view, while warranty routes need warranty.view. H2 verifies the former permission passes without the latter. The history response exposes full shaped warranty details.  
**Business impact:** Revoking warranty.view does not consistently remove warranty-data access for users who still have customer.view.  
**Recommended fix:** Define one explicit warranty-data policy and apply it to all embedding/search/customer endpoints, including field-level exposure where needed.

Inspected security safeguards: every warranty/claim route uses requireAuth and permission middleware; JWT session and active-user validation are server-side (server/middleware/auth.js:78–139); role permissions and per-user overrides are loaded from the database. H1 verifies a missing warranty.create permission produces 403 in middleware. SQL parameters are used for IDs/search and sort fields are allowlisted. React renders terms as text. No warranty DELETE endpoint is exposed.

Object authorization: this is a single-store staff application, not a multi-tenant customer portal. Broad cross-cashier access may be intentional; no creator ownership restriction is enforced. That is not inherently an IDOR finding without a narrower business policy. F03/F16 are concrete cross-object integrity defects; F20/F21 are concrete permission problems. Live token tampering, unauthorized HTTP requests and deployed custom roles are NOT TESTED.

Claim create/edit/resolve/reject/supplier actions all share warranty.claim; there is no separation between submitting and authorizing replacement. Product default terms are controlled separately by product.edit. Direct DB writes can bypass the API. Initial migrations had no append-only audit guard; the concurrent migration adds one as described in F22. Actual production DB grants, deployment of that migration and resistance to privileged DB manipulation were not queried or tested.

## 14. Audit Trail

**F22 — Warranty audit history is best effort, nontransactional and incomplete.**  
**Severity:** High · **Status:** PARTIAL / FAIL (code inspection) · **Priority:** P1  
**File/lines:** server/utils/activityLog.js:3–28; server/db/migrations/001_init.sql:84–94; server/controllers/warrantiesController.js:280–286; server/controllers/warrantyClaimsController.js:209–215; server/services/returnService.js:972–985; server/services/warrantyService.js:451–487,704–709,742–748.  
**Root cause/evidence:** At the audited revision, logActivity opens a pool query independently of the caller transaction and catches errors. Events can survive a failed business transaction or be missing after a successful one. Calls usually omit oldValue and mandatory reason; automatic return voids have no individual warranty activity entry; old warranty claimed transition is not fully logged. Some socket/notification events are sent inside transactions, before commit. The initial activity_log table had no hash/signature or append-only enforcement. **Concurrent working-tree change:** server/utils/activityLog.js:11–39 now accepts a transaction client and stores performed_by_name; server/db/migrations/038_customer_audit_integrity.sql:34–50 adds an UPDATE/DELETE guard with a performed_by-null exception. Warranty service/controller callers still omit client, so their logs remain independent and best effort. The new guard is partial append-only protection, not complete/tamper-evident warranty history; migration application, TRUNCATE/privileged protection and runtime behavior were NOT TESTED.  
**Business impact:** A dispute cannot reliably reconstruct who changed which entitlement, why, from what original terms, or whether an event actually committed. Concurrent transactions can also consume pool connections while waiting on separate logging work.  
**Recommended fix:** Write complete old/new/reason/reference events through the business transaction client; publish via an after-commit outbox; restrict audit mutations and define retention/tamper-evidence controls.

| Required audit datum | Current coverage |
|---|---|
| Actor | Usually performed_by / created_by / resolved_by; nullable on deletion/system jobs |
| Action / timestamp | Present in generic event table |
| Old value | Table supports it; warranty updates usually omit it |
| New value | Partial payload, not complete snapshot |
| Reason | Optional for manual void/update; rejection requires text |
| Warranty ID | Present when event is warranty entity; not consistently associated on claim events |
| Sale / claim ID | Sometimes notes or JSON; no complete structured linkage chain |
| Immutable history | PARTIAL in concurrent source: UPDATE/DELETE guard added; complete transactional/tamper-evident warranty history still absent and deployment NOT TESTED |
| Every modification | Not covered, especially return void and original replacement transition |

## 15. Concurrent Cashier Scenarios

All schedules below are **code-inspected**, with real database concurrency **NOT TESTED**. Existing locks are acknowledged; they do not repair omitted business checks.

| Scenario | Inspected outcome/risk | Evidence |
|---|---|---|
| Two cashiers, same serial, stock quantity >=2 | Variant locks serialize quantity changes; both invoices can still commit. Active-serial warranty index rejects later coverage only | F07/F08 |
| Two registrations, one nonserialized item | Both can read empty seenItemIds; unique document numbers do not prevent duplicate coverage | F10 |
| Refund concurrent with claim creation | Warranty lock may order operations; existing/open claim is not invalidated when refund later voids coverage | F14/F17 |
| Two warranty edits | No row version/conditional update; last writer wins on same field | F04/F22; warrantiesController.js:248–276 |
| Duplicate confirmation same invoice | Row lock and draft check reject second confirmation; no successful-result replay | invoiceService.js:511–525 |
| New draft after timeout | Payment idempotency is scoped to invoice; no global checkout key | F10 |
| Two resolutions, same claim | FOR UPDATE plus terminal-state check should prevent double processing | warrantyService.js:620–643; NOT TESTED in DB |
| Two resolutions, different claims on one warranty | Warranty lock serializes them, but both may replace because parent entitlement is not checked | F16/F17 |
| Claim PUT concurrent with resolve | Read/check then unconditional update can reopen closed claim | F17 |
| DB interruption before sale commit | withTransaction rollback path exists; committed-outcome ambiguity under network loss NOT TESTED | postgres.js:52–64 |
| Backend restart after sale commit | Post-commit warranty registration can be lost permanently | F08 |
| Cancellation before pending registration | Registration can create active coverage after cancellation | F09 |
| Product default changes during deferred registration | New terms/default read after sale, not sale-time policy | F13 |
| Partial replacement failure | Claim replacement DB changes use one transaction; independent logs/events can disagree | F18/F22 |

No advisory unit lock, unit reservation, optimistic warranty version, or durable retry queue was found. Document numbering uses INSERT ... ON CONFLICT to allocate unique sequences (server/utils/docNumbers.js:17–36), which is a positive safeguard for numbers only.

## 16. Warranty Dashboard Accuracy

**F23 — Dashboard counts and claim rates do not consistently measure effective coverage or defects.**  
**Severity:** High · **Status:** FAIL / PARTIAL (query inspection) · **Priority:** P1  
**File/lines:** server/controllers/warrantiesController.js:115–137,346–380; server/controllers/warrantyClaimsController.js:98–109; server/services/reportService.js:1570–1580,1645–1660.  
**Root cause/evidence:** Active counts rely on stored status and include overdue rows until sweep; no start-date check excludes future coverage. Customer and supplier coverage are mixed. Product stats divide all claims by warranty records, not units sold. Product report limits warranties by created_at but joins all their claims without a claim-period filter. Duplicate/rejected claims, replacements and returned/void coverages have no explicit denominator policy.  
**Business impact:** Claim rate can exceed 100%, quantity-three and quantity-one lines count equally, and a “high defect” product ranking can be misleading.  
**Recommended fix:** Define event-period versus sold-cohort metrics, effective coverage, unique affected units/quantities and approved defect categories; distinguish customer/supplier coverage and returned/replaced units. Label claim frequency separately from defect probability.

| Requested report | Current availability |
|---|---|
| Active / expiring / expired | Counts exist but stale-status limitations apply |
| Total/open/in-progress/rejected claims | Counts/list exist |
| Approved claims | No separate approval state |
| Repairs / replacements | resolution field/report rows exist; no dedicated cost dashboard |
| Warranty cost | NOT IMPLEMENTED as attributable repair/replacement/recovery accounting |
| Claims by product | Exists with denominator limitations |
| Claims by brand/supplier | No dedicated warranty analytic grouping found |
| Defect frequency / eligible-unit claim rate | NOT IMPLEMENTED with reliable definitions |
| Supplier pending | Raised=true and resolved=false count only |

No live aggregates or benchmark dataset were compared with actual PostgreSQL results. Claim frequency alone is not evidence that a brand is defective.

## 17. Data Integrity

**F24 — Confirmed invoice corrections can detach old warranties and omit new ones.**  
**Severity:** High · **Status:** FAIL (code/schema inspection) · **Priority:** P1  
**File/lines:** server/services/invoiceService.js:1094–1148,1220–1230,1278–1289,1312–1340; server/db/migrations/008_warranties.sql:9.  
**Root cause/evidence:** Equal-total confirmed corrections can add/remove invoice lines and move stock. Removing a line sets warranty.invoice_item_id to NULL via its FK; added lines do not receive warranties and changed quantity does not reconcile coverage. The applyEditRequest flow has no warranty synchronization.  
**Business impact:** A financially valid correction leaves obsolete active warranty evidence and missing coverage for newly supplied products.  
**Recommended fix:** Prohibit identity/quantity corrections outside explicit return/reissue, or transactionally reconcile coverage and preserve superseded line history.

**F25 — Backup includes warranty tables by design, but restore can falsely report success.**  
**Severity:** High · **Status:** FAIL (restore result handling); inclusion PARTIAL (code verified, actual backup NOT TESTED) · **Priority:** P1  
**File/lines:** server/backup/strategies/dbBackup.js:38–49,79–99; server/backup/backupService.js:580–604.  
**Root cause/evidence:** Full custom-format pg_dump has no warranty table exclusion, so successful dumps include the tables and relationships. Restore treats exit code 1 as success, despite it representing a restore with errors; caller proceeds to successful completion. No post-restore warranty FK/count consistency gate is shown.  
**Business impact:** Operators can be told restoration succeeded while warranty tables, rows or constraints are incomplete.  
**Recommended fix:** Treat nonzero exit as failure requiring explicit diagnostic review; restore with controlled error/transaction handling into an isolated target, and verify tables, constraints and representative lifecycle records before service cutover.

Product/customer deletion APIs are soft-delete (productsController.js:466–475; customersController.js:486–493), retaining normal references. Physical deletion uses SET NULL on most warranty links, preserving the warranty row but losing joined identity/provenance; there are no complete customer/product snapshots. Claims restrict deleting a referenced warranty, but nullable claim linkage permits unattached rows via direct SQL. Warranty deletion has no HTTP route.

Persistence is PostgreSQL backed with a Docker named data volume (docker-compose.yml:21–24). Source indicates survival across ordinary restarts; no restart, data-volume loss or restore test was performed. Backup retention is operationally separate from the incomplete warranty event history and the unverified concurrent audit guard. No claim is made that existing production data is clean.

Recommended read-only integrity checks for a later approved environment: coverage missing for eligible confirmed lines; active coverage on cancelled/full-returned lines; duplicated invoice-item coverage; contradictory product/variant and invoice/item/customer associations; multiple open claims per unit/allocation; invalid dates/statuses; lost references; and remaining covered quantity versus sold/returned quantity. Historical product defaults alone cannot reliably reconstruct past eligibility, so a “missing warranty” query must account for missing policy snapshots.

## 18. Performance

**F26 — History and reports are unbounded; fuzzy lookups cannot rely on existing B-tree indexes.**  
**Severity:** Medium · **Status:** PARTIAL (query inspection; performance NOT TESTED) · **Priority:** P2  
**File/lines:** server/controllers/warrantiesController.js:67–73,91–108,153–181,324–337; server/controllers/customersController.js:760–778; server/services/reportService.js:1570–1580,1607–1618,1645–1660; server/utils/response.js:11–15.  
**Root cause/evidence:** Main lists cap page size at 100 and use joins rather than per-row fetches, but customer history, per-warranty claim history and reports have no bounds. Serial/invoice/customer lookup uses leading-wildcard ILIKE across joins; plain B-tree serial index is not an efficient substring-search solution. Offset paging and COUNT joins grow with history. Lookup returns only 20 matches, which also makes it unsafe as a uniqueness validator.  
**Business impact:** Large histories can produce slow multi-cashier searches, oversized responses and timeouts; substring truncation can miss exact serial conflicts.  
**Recommended fix:** Add exact canonical serial/invoice endpoints first, cursor pagination and bounded/report-job exports; consider measured trigram search where genuinely needed, and add workload-specific composite indexes after EXPLAIN ANALYZE in an approved isolated dataset.

No latency, capacity, EXPLAIN, concurrent-load or N+1 runtime claim was measured. The list/detail SQL is join-based; automatic warranty creation still makes multiple per-item queries and independent audit writes. Keep operational lookup responsive independently of full-history reporting.

## 19. UAE Documentation Gaps

**F27 — Structured warranty documentation and service-period evidence are missing.**  
**Severity:** High · **Status:** PARTIAL / NOT IMPLEMENTED (document capability review) · **Priority:** P1, with qualified UAE legal review  
**File/lines:** server/db/migrations/008_warranties.sql:3–48; server/services/warrantyService.js:185,712–750; server/services/pdfService.js:208–229,297–298,415–428.  
**Root cause/evidence:** Generic optional terms and customer/supplier type do not capture provider obligations, covered components, exclusions, repair responsibility, policy version, receipt/delivery date, service downtime or extended-coverage terms as reproducible documents. Auto terms are null; standard invoice/receipt does not render warranty/serial evidence.  
**Business impact:** Staff cannot consistently issue or reproduce the intended coverage particulars or explain service-based extensions. This is a capability gap, not a legal finding of noncompliance.  
**Recommended fix:** Agree the required policy/document model with qualified UAE counsel, then freeze and render it in appropriate customer-facing formats, including service intake/return evidence.

| Requested particular | Capability |
|---|---|
| Provider | Optional supplier relation and customer/supplier label; no explicit manufacturer/store provider snapshot |
| Product / purchase date / duration | Relational product, invoice date and warranty dates/months exist, with prior accuracy/association gaps |
| Conditions / exclusions / covered components | Can be typed into generic manual terms; no structured purchase-time policy |
| Repair/replacement obligations | No dedicated fields/document |
| Extended warranty | Manual date edits possible; no approved extension product/history workflow |
| Certificate / receipt warranty particulars | No dedicated certificate; standard receipt/invoice omission |
| Repair downtime / redelivery | No service-interval ledger or automatic extension |

External legal context was checked on 24 October 2026. Articles 6, 11 and 12 address invoice/warranty-document particulars; Article 19 addresses commencement and extensions associated with covered repair/maintenance interruptions. These are questions for counsel to apply to the actual goods, delivery and service practices. See the [Ministry-hosted English text of Cabinet Decision 66/2023](https://www.moet.gov.ae/documents/20121/0/CabinetDecision_66_2023_pdf.pdf/01f05bd9-a15b-b353-b297-f834152e1c3a). The [UAE government consumer-protection overview](https://u.ae/en/information-and-services/justice-safety-and-the-law/consumer-protection) also describes Arabic invoice requirements; ask counsel to assess language and disclosure requirements. This audit does not determine current legal applicability, completeness of translations, or compliance. The legislation portal PDF download returned 403; the Ministry-hosted English PDF was accessible.

## 20. Edge-Case Test Matrix

**Evidence keys:** H1 = first source-execution harness, 34 assertions; H2 = second, 18 assertions; H3 = fixed-clock harness, 5 assertions. All used synthetic data and mocked queries that recorded SQL without executing it. No test framework, database or browser suite was run. Findings F01–F27 contain source paths/lines for static outcomes.

“Actual” explicitly distinguishes execution from inspection. A FAIL based on source does not imply a live transaction was performed.

| # | Preconditions | Action | Expected behavior | Actual behavior / execution | Result | Evidence | Risk |
|---|---|---|---|---|---|---|---|
| 1 | Product default 0 | Register synthetic invoice | No automatic coverage | H2 returned zero rows | PASS (isolated) | H2; warrantyService.js:145–146 | Low |
| 2 | Default 12, valid dates | Register synthetic line | One correct allocation/date snapshot | H2 captured expected invoice/item and 12-month dates | PASS (isolated mapping only) | H2 | Live atomicity still F08 |
| 3 | Zero-day warranty requirement | Configure/create | Explicit disable or supported zero policy | Product zero disables; manual positive months required; no days unit | PARTIAL | F04/F11 | Ambiguous terms |
| 4 | Negative/fractional/excess product months | Validate input | Reject | H2 rejected -1/1.5/121, accepted 0/12 | PASS (schema) | H2; productsController.js:42 | Direct SQL unconstrained |
| 5 | Quantity three same SKU | Register coverage | Track units or covered quantity | H2 created one quantityless warranty; cart merges variant | FAIL | H2/F06 | Partial entitlement lost |
| 6 | Same product sold on different dates | Make separate completed sales | Independent sale snapshots | Code creates per-item records using each confirmation date; no DB sales executed | NOT TESTED | F08/F13 | Missing registration |
| 7 | Anonymous buyer | Register synthetic invoice | Receipt-linked coverage without customer | H2 captured null customer, correct invoice/item | PASS (isolated) | H2/F13 | Receipt omits coverage |
| 8 | Customer with warranty soft-deleted | Retrieve history | Retain evidence | Soft-delete retains row by inspection; no deletion executed | NOT TESTED | customersController.js:486; F05 | Hard delete loses identity |
| 9 | Product with warranty soft-deleted | Retrieve old warranty | Preserve sale identity/policy | Soft-delete retains row; live product join can rename history | PARTIAL | F13/F25 | Historical detail drift |
| 10 | Product policy changed after sale | Read old/backfill coverage | Purchase policy unchanged | Existing duration stored; backfill reads current policy, terms absent | PARTIAL | F13 | Wrong historical terms |
| 11 | Cancelled invoice | Automatic registration / cancellation | No claimable coverage | H2 service accepted cancelled synthetic row; race identified | FAIL | H2/F09 | Free service/replacement |
| 12 | Failed payment allocation | Confirm sale | No sale/stock/coverage commit | Main code rejects insufficient allocation; no live payment tested | NOT TESTED | invoiceService.js:532–535 | Integration unverified |
| 13 | One of three units returned | Approve return | Remaining two retain rights | Whole invoice-item warranty void in SQL | FAIL (inspection) | F14 | Customer rights lost |
| 14 | All units returned | Approve refund | Coverage and refund state consistent | Active line coverage voids in return transaction; prior claims remain resolvable | PARTIAL | F14/F17 | Duplicate benefit |
| 15 | Different-product exchange | Approve customer_replace | New unit and correct coverage | Direct invoice, NULL serial, no warranty call | FAIL (inspection) | F15 | Missing coverage |
| 16 | Valid claim replacement | Resolve replaced | Record new serial/product/source | Serial NULL; cross-product inconsistency possible | FAIL (inspection) | F01/F18 | Wrong stock lineage |
| 17 | Active stored row past end date | Submit synthetic claim | Reject expired entitlement | H1/H3 reject; displayed status remains active | PASS guard / FAIL display | H1/H3/F11 | Misleading staff |
| 18 | Expired warranty, extend end date | Submit synthetic claim | Explicit policy-based reactivation | H3 still rejects; duration-only update does not recalc end | FAIL | H1/H3/F04 | Extension ineffective |
| 19 | Same active product/serial | Concurrent sales | Prevent duplicate unit sale | Warranty index only; sale already committed | FAIL (inspection) | F07/F08 | Double sale |
| 20 | Confirm response lost | Retry checkout | Idempotent replay | Same invoice rejected as nondraft; different drafts not deduped globally | PARTIAL | F10 | Duplicate/stranded checkout |
| 21 | Two cashiers register same nonserial item | Concurrent registration | Exactly one allocation | No DB invoice-item unique guard; concurrent DB run not executed | FAIL (inspection) | F10 | Duplicate coverage |
| 22 | Network interrupted after commit | Reconnect | Recover final result and coverage | No durable registration retry | FAIL (inspection) | F08/F10 | Permanent omission |
| 23 | Backend restart during post-commit gap | Restart | Durable completion | No restart executed; code has no recovery job | NOT TESTED; design FAIL | F08 | Missing warranties |
| 24 | Error within warranty transaction | Roll back | No warranty or misleading audit | DB rollback wrapper exists; external audit/events can survive | PARTIAL | F22 | False audit |
| 25 | Backup containing linked warranties | Restore isolated target | All rows/constraints intact, fail on errors | No backup/restore executed; code accepts exit 1 | NOT TESTED; handler FAIL | F25 | False recovery success |
| 26 | User lacks warranty.create | Invoke middleware | 403 | H1 returned 403 | PASS (middleware only) | H1 | HTTP/token not tested |
| 27 | Seeded Cashier defaults | Edit/void guard | Restricted destructive permission | H2 passes warranty.create | FAIL (policy) | H2/F20 | Unauthorized-by-intent edits |
| 28 | customer.view without warranty.view | Access history guard | Consistent warranty policy | H2 customer.view guard passes | FAIL | H2/F21 | Read restriction bypass |
| 29 | Existing open claim | Submit second | Reject conflicting active claim | H1 creates two open records in fake query model | FAIL | H1/F16 | Repeated replacement |
| 30 | Future-start warranty or mismatched customer | Create claim | Reject/not yet eligible, validate customer | H1 accepts future and different customer | FAIL | H1/F16 | False entitlement |
| 31 | Warranty already claimed/replaced | Create claim | Enforce replacement closure policy | H1 accepts another claim | FAIL | H1/F16 | Repeated benefits |
| 32 | Claim then warranty void/refund | Resolve claim | Revalidate conflict atomically | Resolver ignores current entitlement | FAIL (inspection) | F17 | Stock leakage |
| 33 | Two resolve requests same claim | Resolve concurrently | At most one issue | Lock/state guard present; no actual race test | NOT TESTED | warrantyService.js:620–643 | Confirm in DB |
| 34 | PUT racing terminal resolve | Update in_progress | Reject stale update | Unconditional ID update permits stale write | FAIL (inspection) | F17 | Reopened terminal claim |
| 35 | Active supplier coverage on same serial | Sell customer coverage | Coverage layers coexist | Shared active serial guard rejects customer row after sale | FAIL (inspection) | F19/F08 | Lost sale warranty |
| 36 | Correct invoice ID query | List invoice coverage | Only matching records | H1 captured queries with no invoice filter | FAIL | H1/F12 | Wrong customer association |
| 37 | Return good/defective/damaged goods | Approve return | Correct stock and entitlement state | Stock condition handling exists; whole-line void unchanged | PARTIAL | F14/F15 | Unit identity missing |
| 38 | Full/partial refund bookkeeping failure | Inject failure | Roll back return/coverage/stock | No database failure injection performed | NOT TESTED | returnService.js:730–1220 | Unverified rollback |
| 39 | Used receipt years later | Lookup/reprint | Immutable original policy | Search exists; docs omit coverage and use current terms | PARTIAL | F13 | Dispute evidence |
| 40 | Confirmed equal-total line correction | Replace/remove item | Reconcile coverage history | No warranty sync; removed FK SET NULL | FAIL (inspection) | F24 | Orphaned entitlement |
| 41 | 30-/90-day policies | Create/expire | Fixed-day arithmetic | No day duration model/API | NOT IMPLEMENTED | F11 | Wrong substitution |
| 42 | Month-end/leap/year boundaries, three zones | Execute date helper | Clamp consistently | 21 H1 expected outcomes matched | PASS (helper) | H1 | API validation still F04 |
| 43 | Expiry midnight boundary | Submit fixed-clock claim | Valid through agreed inclusive end | H3 allowed 23:59:59, rejected 00:00 Dubai | PASS (helper/service) | H3 | Clock skew not tested |
| 44 | Impossible date / invalid date input | Compute/submit | Reject cleanly | H1 normalizes impossible date; invalid difference becomes 0 | FAIL | H1/F04/F11 | Misdated evidence |
| 45 | Repair closed | Record repair and downtime | Track work/cost and extension if policy requires | Only resolution marker; no intervals/cost workflow | PARTIAL | F18/F27 | Unsubstantiated service |
| 46 | Store credit or refund reversal | Complete workflow | Auditable entitlement transition | Debt reduction only; reversal/coverage restoration absent | NOT IMPLEMENTED for full requested workflows | Section 10 | Incorrect recovery |
| 47 | Database clock differs from API clock | Boundary claims/sweep | Defined authoritative date behavior | No clock-skew execution | NOT TESTED | F11 | Inconsistent boundary |
| 48 | Large customer/product history | Search/report under load | Bounded responsive queries | Unbounded history/report code; no benchmark | NOT TESTED | F26 | Multi-cashier latency |

### Executed harness provenance and reproducibility

Node ran each script through PowerShell's single-quoted here-string piped to node. Scripts read source files and load selected modules with a strict import allowlist; all SQL calls were replaced by synthetic handlers. No server bootstrap, dotenv, connection pool, application HTTP call, test-global-setup or file-writing API was invoked. Stock access was stubbed to throw. Activity logging and notifications were no-op stubs. This is source-level behavior verification, not PostgreSQL semantics.

H1: 34 assertions completed; H2: 18 completed; H3: 5 completed. The assertions intentionally assert observed defective behavior as well as correct behavior, so process success must not be mistaken for product readiness. Exact standalone scripts are included at the end of this section below.

<details>
<summary>H1 — exact executed Node script (34 assertions)</summary>

Run from the repository root by piping this script to `node`; it does not connect to PostgreSQL.

```javascript
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const errors=require('./shared/errorCodes');
const dates=require('./server/utils/dates');
function load(file,deps,extra={}) {
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:n=>{if(!(n in deps))throw Error('Blocked import: '+n);return deps[n]},Date,console,...extra},{filename:file});
 return module.exports;
}
let queryHandler=async()=>{throw Error('Unexpected SQL')};
let number=0;
const db={query:(...a)=>queryHandler(...a),withTransaction:fn=>fn({query:(...a)=>queryHandler(...a)})};
const deps={'../db/postgres':db,'../utils/dates':dates,'../../shared/errorCodes':errors,'../utils/docNumbers':{nextDocumentNumber:async()=>({formatted:'SYN-'+(++number)})},'./stockService':{applyStockMovement:async()=>{throw Error('Stock access blocked')}},'../utils/activityLog':{logActivity:async()=>{}},'./notificationService':{notifyManagersAndAdmins:async()=>{}}};
const svc=load('server/services/warrantyService.js',deps);
let checked=0;
function check(id,actual,expected){assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)),expected,id);checked++;console.log(id+' '+JSON.stringify(actual));}
(async()=>{
for(const tz of ['Asia/Dubai','UTC','America/Los_Angeles']){
 process.env.TZ=tz;
 for(const [s,m,e] of [['2026-01-31',1,'2026-02-28'],['2024-01-31',1,'2024-02-29'],['2024-02-29',12,'2025-02-28'],['2024-02-29',24,'2026-02-28'],['2026-12-31',1,'2027-01-31'],['2026-10-24',12,'2027-10-24'],['2026-10-24',24,'2028-10-24']])check('DATE '+tz+' '+s+' +'+m,svc.addMonthsDate(s,m),e);
}
process.env.TZ='Asia/Dubai';
check('DATE invalid text',svc.addMonthsDate('not-a-date',12),null);
check('DATE null start',svc.addMonthsDate(null,12),null);
check('DEFECT impossible calendar normalized',svc.addMonthsDate('2026-02-30',1),'2026-04-02');
check('DEFECT invalid days treated zero',svc.daysBetween('bad','2026-01-01'),0);
process.env.TZ='America/Los_Angeles';
check('DEFECT mixed pg Date and ISO end off one',svc.daysBetween(new Date(2026,0,31,12), '2026-02-01'),0);
process.env.TZ='Asia/Dubai';
let w={id:'w',status:'active',start_date:'2099-01-01',end_date:'2099-12-31',customer_id:'owner',warranty_number:'SYN-W',product_id:'p'};
let inserted=[];
queryHandler=async(sql,p)=>{
 if(sql.includes('SELECT w.*')) return {rows:[w]};
 if(sql.includes('INSERT INTO warranty_claims')){const row={id:'c'+inserted.length,warranty_id:p[1],customer_id:p[2],status:'open'};inserted.push(row);return {rows:[row]};}
 throw Error('Unexpected query '+sql);
};
await svc.createClaim({warrantyId:'w',customerId:'different',issueDescription:'Synthetic defect'});
await svc.createClaim({warrantyId:'w',issueDescription:'Second synthetic defect'});
check('DEFECT future warranty claim and customer override',[inserted[0].customer_id,inserted[0].status],['different','open']);
check('DEFECT duplicate open claims',inserted.length,2);
w.status='claimed';
await svc.createClaim({warrantyId:'w',issueDescription:'Already replaced'});
check('DEFECT claimed warranty accepts claim',inserted.length,3);
w.status='void';
let rejected;try{await svc.createClaim({warrantyId:'w',issueDescription:'Invalid'});}catch(e){rejected=e.code}
check('GUARD void claim rejected',rejected,errors.ERROR_CODES.BIZ_WARRANTY_VOID);
w.status='active';w.end_date='2000-01-01';
try{await svc.createClaim({warrantyId:'w',issueDescription:'Expired'});}catch(e){rejected=e.code}
check('GUARD expired claim rejected',rejected,errors.ERROR_CODES.BIZ_WARRANTY_EXPIRED);
const queries=[];
const ctl=load('server/controllers/warrantiesController.js',{'zod':require('zod'),'../db/postgres':db,'../utils/response':require('./server/utils/response'),'../../shared/errorCodes':errors,'../services/warrantyService':svc,'../utils/activityLog':{logActivity:async()=>{}}});
queryHandler=async(sql,p)=>{queries.push({sql,p});return {rows:sql.includes('COUNT(*)')?[{total:0}]:[]}};
const res={json:x=>x,status(){return this}};
await ctl.list({query:{invoice_id:'11111111-1111-4111-8111-111111111111'}},res,e=>{throw e});
check('DEFECT invoice filter unused',queries.every(q=>!q.sql.includes('w.invoice_id =')&&!q.p.includes('11111111-1111-4111-8111-111111111111')),true);
queries.length=0;
queryHandler=async(sql,p)=>{queries.push({sql,p});return {rows:[{id:'w',status:'active',start_date:'2026-01-01',end_date:'2027-01-01',duration_months:12}]}};
await ctl.update({params:{id:'w'},body:{durationMonths:24},user:{id:'synthetic'}},res,e=>{throw e});
check('DEFECT duration update leaves end untouched',queries.find(q=>q.sql.startsWith('UPDATE')).sql.includes('end_date'),false);
const perm=require('./server/middleware/permissions');
let code;
perm.requirePermission('warranty.create')({user:{permissions:[]}}, {}, e=>code=e?.status);
check('GUARD missing permission rejected',code,403);
const roles=require('./shared/permissions');
console.log('PERMISSION EXPORTS '+Object.keys(roles).join(','));
console.log('ASSERTIONS '+checked+'; in-memory only; no database/network/file writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
```

</details>

<details>
<summary>H2 — exact executed Node script (18 assertions)</summary>

Run from the repository root by piping this script to `node`; it does not connect to PostgreSQL.

```javascript
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const errors=require('./shared/errorCodes');
const dates=require('./server/utils/dates');
function load(file,deps,extra={}) {
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:n=>{if(!(n in deps))throw Error('Blocked import: '+n);return deps[n]},Date,console,...extra},{filename:file});
 return module.exports;
}
let queryHandler=async()=>{throw Error('Unexpected SQL')};
let number=0;
const db={query:(...a)=>queryHandler(...a),withTransaction:fn=>fn({query:(...a)=>queryHandler(...a)})};
const deps={'../db/postgres':db,'../utils/dates':dates,'../../shared/errorCodes':errors,'../utils/docNumbers':{nextDocumentNumber:async()=>({formatted:'SYN-'+(++number)})},'./stockService':{applyStockMovement:async()=>{throw Error('Stock access blocked')}},'../utils/activityLog':{logActivity:async()=>{}},'./notificationService':{notifyManagersAndAdmins:async()=>{}}};
const svc=load('server/services/warrantyService.js',deps);

let checks=0;function check(id,a,e){assert.deepStrictEqual(JSON.parse(JSON.stringify(a)),e,id);checks++;console.log(id+' '+JSON.stringify(a));}
(async()=>{
process.env.TZ='Asia/Dubai';
const calls=[];let months=12;
const inv={id:'i',invoice_number:'SYN-I',customer_id:null,confirmed_at:new Date('2026-10-24T01:00:00Z'),created_at:new Date('2026-10-23T01:00:00Z'),status:'cancelled'};
queryHandler=async(sql,p)=>{
 calls.push({sql,p});
 if(sql.includes('FROM invoices')) return {rows:[inv]};
 if(sql.includes('FROM invoice_items')) return {rows:[{id:'item',quantity:3,product_id:'p',variant_id:'v',default_warranty_months:months,serial_number:null}]};
 if(sql.includes('SELECT invoice_item_id FROM warranties'))return {rows:[]};
 if(sql.includes('INSERT INTO warranties'))return {rows:[{id:'w',invoice_id:p[3],invoice_item_id:p[4],customer_id:p[5],start_date:p[7],end_date:p[8],duration_months:p[9],terms:p[10]}]};
 throw Error('Unexpected query '+sql);
};
let result=await svc.createWarrantiesFromInvoice('i');
check('AUTO qty3 yields one record',result.length,1);
check('AUTO anonymous and invoice links',[result[0].customer_id,result[0].invoice_id,result[0].invoice_item_id],[null,'i','item']);
check('AUTO purchase dates and duration',[result[0].start_date,result[0].end_date,result[0].duration_months],['2026-10-24','2027-10-24',12]);
check('AUTO no terms snapshot',result[0].terms,null);
check('DEFECT cancelled invoice not rejected',result.length,1);
months=0;result=await svc.createWarrantiesFromInvoice('i');check('GUARD zero product months skips',result.length,0);
const productSource=fs.readFileSync('server/controllers/productsController.js','utf8');
const schemaText=productSource.slice(productSource.indexOf('const baseProductSchema ='),productSource.indexOf('const simpleVariantSchema ='));
const schemaCtx={z:require('zod').z,SOLD_BY:['piece','meter','roll','kg','box'],MAX_QTY:999999};
vm.runInNewContext(schemaText+';this.schema=baseProductSchema;',schemaCtx);
for(const [m,e] of [[0,true],[12,true],[-1,false],[1.5,false],[121,false]])check('PRODUCT duration '+m,schemaCtx.schema.safeParse({name:'Synthetic',defaultWarrantyMonths:m}).success,e);
const ctl=load('server/controllers/warrantiesController.js',{'zod':require('zod'),'../db/postgres':db,'../utils/response':require('./server/utils/response'),'../../shared/errorCodes':errors,'../services/warrantyService':svc,'../utils/activityLog':{logActivity:async()=>{}}});
calls.length=0;
queryHandler=async(sql,p)=>{calls.push({sql,p});return {rows:[{id:'w',status:'active',start_date:'2026-01-01',end_date:'2027-01-01',duration_months:12}]}};
const res={json:x=>x,status(){return this}};
await ctl.update({params:{id:'w'},body:{endDate:'2025-01-01'},user:{id:'synthetic'}},res,e=>{throw e});
check('DEFECT inverted warranty dates reach UPDATE',calls.some(x=>x.sql.startsWith('UPDATE')&&x.p.includes('2025-01-01')),true);
const perms=require('./server/middleware/permissions');const roles=require('./shared/permissions').ROLE_DEFAULTS;
let allowed=false;perms.requirePermission('warranty.create')({user:{permissions:roles.Cashier}}, {}, e=>{if(e)throw e;allowed=true});
check('PERMISSION seeded Cashier permitted create/edit/void',allowed,true);
let visible=false;perms.requirePermission('customer.view')({user:{permissions:['customer.view']}},{},e=>{if(e)throw e;visible=true});
check('PERMISSION customer warranty history without warranty.view',visible,true);
const policy=require('./shared/warrantyClaimPolicy');
check('POLICY open to in_progress',policy.assertWarrantyClaimStatusTransition('open','in_progress')===undefined,true);
for(const pair of [['in_progress','open'],['resolved','in_progress'],['rejected','open']]){
 let blocked=false;try{policy.assertWarrantyClaimStatusTransition(...pair)}catch(e){blocked=e.code===errors.ERROR_CODES.BIZ_INVALID_STATE}
 check('POLICY '+pair.join(' to ')+' blocked',blocked,true);
}
console.log('ASSERTIONS '+checks+'; in-memory only; SQL recorded not executed');
})().catch(e=>{console.error(e);process.exitCode=1});
```

</details>

<details>
<summary>H3 — exact executed Node script (5 assertions)</summary>

Run from the repository root by piping this script to `node`; it does not connect to PostgreSQL.

```javascript
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const errors=require('./shared/errorCodes');
const dates=require('./server/utils/dates');
function load(file,deps,extra={}) {
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:n=>{if(!(n in deps))throw Error('Blocked import: '+n);return deps[n]},Date,console,...extra},{filename:file});
 return module.exports;
}
let queryHandler=async()=>{throw Error('Unexpected SQL')};
let number=0;
const db={query:(...a)=>queryHandler(...a),withTransaction:fn=>fn({query:(...a)=>queryHandler(...a)})};
const deps={'../db/postgres':db,'../utils/dates':dates,'../../shared/errorCodes':errors,'../utils/docNumbers':{nextDocumentNumber:async()=>({formatted:'SYN-'+(++number)})},'./stockService':{applyStockMovement:async()=>{throw Error('Stock access blocked')}},'../utils/activityLog':{logActivity:async()=>{}},'./notificationService':{notifyManagersAndAdmins:async()=>{}}};
const svc=load('server/services/warrantyService.js',deps);

let checks=0;function check(id,a,e){assert.deepStrictEqual(a,e,id);checks++;console.log(id+' '+JSON.stringify(a));}
(async()=>{
process.env.TZ='Asia/Dubai';
let instant='2026-10-24T19:59:59Z';
const RealDate=Date;class ClockDate extends RealDate{constructor(...a){super(...(a.length?a:[instant]))}static now(){return new RealDate(instant).getTime()}}
const s=load('server/services/warrantyService.js',deps,{Date:ClockDate});
let warranty={id:'w',warranty_number:'SYN-W',status:'active',start_date:'2025-10-24',end_date:'2026-10-24'};
queryHandler=async(sql,p)=>{
 if(sql.includes('SELECT w.*'))return {rows:[warranty]};
 if(sql.includes('INSERT INTO warranty_claims'))return {rows:[{id:'synthetic'}]};
 throw Error('Unexpected SQL');
};
await s.createClaim({warrantyId:'w',issueDescription:'Synthetic'});
check('BOUNDARY last second valid',true,true);
instant='2026-10-24T20:00:00Z';
let rejected;try{await s.createClaim({warrantyId:'w',issueDescription:'Synthetic'})}catch(e){rejected=e.code}
check('BOUNDARY next Dubai midnight rejected',rejected,errors.ERROR_CODES.BIZ_WARRANTY_EXPIRED);
check('DEFECT shaped stale active remains active',s.shapeWarranty(warranty).status,'active');
check('SHAPE expired days remaining',s.shapeWarranty(warranty).daysRemaining,-1);
warranty.status='expired';warranty.end_date='2027-10-24';
try{await s.createClaim({warrantyId:'w',issueDescription:'Synthetic'})}catch(e){rejected=e.code}
check('DEFECT extended expired warranty still rejects',rejected,errors.ERROR_CODES.BIZ_WARRANTY_EXPIRED);
console.log('ASSERTIONS '+checks+'; synthetic fixed clock; no I/O writes');
})().catch(e=>{console.error(e);process.exitCode=1});
```

</details>

## 21. Critical Bugs

Production blockers, ordered by exposure:

| Priority | Finding | Concrete trigger / result |
|---|---|---|
| P0 | F08/F09 | Sale/cancellation commits, warranty operation fails or races → missing/incorrectly active coverage |
| P0 | F06/F07 | Same serial or quantity-three line → no exclusive physical identity/quantity entitlement |
| P0 | F14/F15 | Partial return or exchange → valid retained coverage voided / replacement uncovered |
| P0 | F16/F17 | Duplicate/claimed/refunded claim → multiple or invalid replacements |
| P0 | F18 | Different replacement variant or serialized replacement → mixed product IDs / unknown serial |
| P0 | F20 | Cashier with default permissions → arbitrary date/customer/serial edits and voiding |
| P1 | F01/F12 | UI registration/replacement blocked; invoice displays unrelated warranty records |
| P1 | F04/F10/F13/F24 | Date edits, retries, policy changes, invoice corrections → contradictory/missing historical coverage |
| P1 | F19/F22/F25 | Supplier coverage conflict, incomplete audit, false restore success |

Critical severity is assigned to failures that can deny valid customer coverage, lose guaranteed sale coverage or repeatedly issue physical replacement goods. P0 also includes selected High findings whose fixes are prerequisites for safe production use.

## 22. Missing Features

These are feature gaps, distinct from broken existing implementations; full metadata and evidence are in the referenced findings.

| Gap | Verification status | Finding |
|---|---|---|
| Physical-unit receipt/sale/return/ownership chain | NOT IMPLEMENTED | F06/F07 |
| Quantity-based entitlement for nonserialized lines | NOT IMPLEMENTED | F06/F14 |
| Fixed-day and explicit year-unit policies | NOT IMPLEMENTED / PARTIAL via months | F11 |
| Versioned provider/brand/supplier policies, component/exclusion snapshots | NOT IMPLEMENTED | F13/F27 |
| Configurable activation/delivery date | NOT IMPLEMENTED | F11/F27 |
| Controlled extensions, downtime adjustments, transfers/suspension | NOT IMPLEMENTED as complete workflows | F04/F27 |
| Complete service order, repair costing, customer notices | NOT IMPLEMENTED | F16–F18 |
| Supplier RMA/credit/recovery ledger | NOT IMPLEMENTED; flags only | F19 |
| Warranty certificate and historical document snapshot | NOT IMPLEMENTED | F13/F27 |
| Effective coverage and distinct-unit defect analytics | NOT IMPLEMENTED | F23 |
| Durable registration retry/reconciliation and checkout replay | NOT IMPLEMENTED | F08/F10 |
| Complete transactional entitlement audit | PARTIAL; concurrent append-only guard does not fill missing warranty events/old values or enlist warranty callers in transactions | F22 |
| Approved refund reversal / general store-credit entitlement workflow | NOT IMPLEMENTED | Section 10 / F14–F17 |

No mandatory serialization is recommended for ordinary nonserialized products. Barcode/SKU identity and unit identity must not be conflated.

## 23. Recommended Fixes

1. **P0 — Make coverage part of sale/return consistency.** Share transaction clients for sale/stock/warranty and cancellation; centralize replacement creation; protect correct covered quantity and unit identity (F06–F10, F14–F18).
2. **P0 — Stop duplicate or invalid replacement benefits.** Add one conflicting active claim per allocation, parent-state/return checks on resolution, and atomic state updates. Preserve multiple legitimate historical claims (F16/F17).
3. **P0 — Correct authority boundaries.** Split warranty edit/extend/void and claim-approve permissions; repair Cashier defaults; require reasons (F20/F21).
4. **P1 — Repair actual user flows.** Fix selector response contracts and invoice filtering; add manual provenance capture and replacement serial input (F01/F02/F12/F18).
5. **P1 — Preserve commercial evidence.** Freeze policy, provider and document snapshots; handle confirmed invoice corrections explicitly; add transactional event history (F03/F04/F13/F22/F24/F27).
6. **P1 — Reconcile deployed data safely.** First run reviewed read-only discrepancy queries against an approved source/snapshot; repair only after business review. Never infer old promised coverage from today's product default.
7. **P1 — Validate restoration and calculations.** Fix restore error handling, define report denominators, effective expiry and supplier coverage layers (F11/F19/F23/F25).
8. **P2 — Scale verified queries.** Add bounded exact lookups/paging and measure realistic multi-cashier history loads (F26).

Before release, execute the matrix against an explicitly isolated PostgreSQL 16 environment with migrations and realistic synthetic records. Include fault injection immediately before/after commit, actual unique-constraint conflicts, concurrent sales/returns/resolutions, authorized/unauthorized HTTP requests and browser journeys. Require a clean backup/restore drill with relationship checks. None of these gates were claimed as completed in this audit.

## 24. Suggested Database Changes (recommendations only)

No migration was created or changed.

- **Policy snapshot:** Versioned warranty policies and immutable sold coverage snapshots (provider, scope, terms, exclusions, duration unit/value, activation rule, dates, delivery evidence).
- **Selective unit registry:** product_units for serialized categories with canonical identifier, variant/product consistency, source PO receipt line, supplier invoice evidence, saleability state and movement/ownership events. Choose serial uniqueness scope with real manufacturer data; do not assume global serial uniqueness.
- **Coverage allocations:** Link policy coverage to sale-line quantity or specific unit. Separate coverage layers/providers so supplier and customer warranties coexist. Prevent duplicate allocation for the same coverage layer, not all historical coverage indiscriminately.
- **Claims:** Required coverage/allocation FK, explicit quantity or unit scope; active-claim exclusion/partial unique rules; resolution and replacement allocation links; supplier recovery cases and work/cost events.
- **Integrity checks:** Positive duration/coverage quantity; valid type/status; end>=start; terminal resolution consistency; supplier-resolved cannot precede raised; documented association constraints. Handle valid legacy exceptions explicitly.
- **Concurrency:** Operation/idempotency keys for checkout and replacement; optimistic version counters; transactionally coordinated locking of invoice/unit/allocation/claim in a consistent order.
- **History:** Append-only entitlement events with actor, old/new policy, reason, sale/return/claim IDs; structured old/new replacement coverage linkage and an outbox.
- **Retention:** Preserve historical product/provider/customer evidence under an approved retention/privacy policy; avoid relying solely on nullable live joins.
- **Performance:** Exact-serial index on canonical identifiers, measured coverage-state/date indexes, claim active lookup and cursor ordering indexes; trigram indexes only if substring search merits them.

Audit and repair existing duplicates/inconsistent associations before adding constraints. Keep expired coverage and repeat service history; do not “deduplicate” legitimate historical claims indiscriminately.

## 25. Suggested API Changes (recommendations only)

No API was changed.

| Endpoint/action proposal | Purpose / required contract |
|---|---|
| Finalize sale with operation key | Atomically allocate stock/units/coverage and return replayable result |
| GET warranties?invoice_id=... | Validate/apply filter to both data and count queries |
| Exact unit/serial lookup | Return identity, saleability and relevant coverages; separate from fuzzy staff search |
| Manual register from invoice item/receipt unit | Derive authoritative product/customer/source; explicit permission/reason for legacy exceptions |
| POST warranties/:id/extend | Reason, new period, expected version, policy validation, audited eligibility transition |
| POST warranties/:id/void | Dedicated permission, mandatory reason, active-claim conflict handling |
| POST claims | Validate dates/customer/allocation/return state; conflict-safe active-claim rule |
| POST claims/:id/resolve | Dedicated authority, expected state/version, replacement serial/unit, correct product/provenance, atomic stock/coverage |
| POST returns/:id/execute | Quantity/unit coverage transition in existing stock/refund transaction |
| GET warranty document/history | Frozen document plus auditable entitlement events |
| Supplier RMA actions | Explicit state/outcome/credit/cost history, not independent booleans |
| Reporting API | Metric definition, period/cohort, distinct units/quantities, bounded pages/exports |
| Reconciliation status | Visible missing/pending/failed coverage with safe idempotent recovery |

Keep authenticated single-store access where appropriate; define any future customer self-service ownership/evidence rules separately. Do not silently allow POST/PUT arbitrary unrelated IDs.

## 26. Production Readiness Verdict

**Not production-ready for reliable end-to-end warranty operations.** Some core functions work in isolation, but existence of pages and tables does not establish a correct transaction lifecycle. The inspected defaults and control flow can both deny legitimate rights and allow repeated invalid replacement benefits.

| Final question | Explicit answer |
|---|---|
| 1. Is the warranty system actually functional? | **Partially.** Real APIs/storage/services exist, but key UI and lifecycle paths are defective; complete runtime operation is not verified. |
| 2. Does every eligible completed sale register its warranty? | **No guarantee; confirmed defect.** Post-commit registration errors are swallowed, and exchange/correction paths omit coverage (F08/F15/F24). |
| 3. Can each physical serialized unit be tracked? | **No.** One serial per line and aggregate inventory do not provide a received-unit-to-customer chain (F06/F07). |
| 4. Are warranty dates accurate? | **Valid calendar-month arithmetic passed tested cases; overall date/state handling is not reliable.** Updates, invalid dates, stale status and extensions have defects (F04/F11). |
| 5. Are warranties linked to invoices and customers correctly? | **Automatic mapping works in isolated checks, but integrity is incomplete.** Manual associations are unchecked and invoice UI filtering is broken (F03/F12/F16). |
| 6. Are anonymous sales supported? | **Yes at the data/service level.** Null customer with invoice/item evidence was exercised; printed coverage details are missing (F13). |
| 7. Are refunds and replacements handled correctly? | **No.** Partial quantity loses remaining rights; ordinary exchange lacks coverage; claim replacement loses serial and may mix products (F14/F15/F18). |
| 8. Are warranty claims functional? | **Partially.** Create/repair/reject/replace code exists, but duplicate, eligibility, UI and concurrency defects prevent a dependable workflow (F01/F16–F18). |
| 9. Are warranty records protected against unauthorized changes? | **Authentication/permissions exist, but not sufficiently.** Cashier defaults permit destructive changes; no dedicated approval/extension controls. Live authorization testing was not done (F20/F21). |
| 10. Can two cashiers create conflicting warranty records? | **Yes by inspected schedules.** Duplicate nonserial coverage and conflicting serial sales are possible; the active serial index only protects a subset of warranty rows (F07/F10/F17). |
| 11. Is warranty history preserved? | **Partially.** Records and some dates/claims persist, but policy/ownership snapshots and complete transactional audit are absent; corrections can detach links. Concurrent code adds a partial audit guard, with deployment unverified (F13/F22/F24). |
| 12. Are warranty reports accurate? | **Not reliably for effective coverage/defect metrics.** Stored status, duplicate claims and record-based denominators distort interpretation; live data not tested (F23). |
| 13. Are warranty records included in backups? | **By whole-database dump design, yes.** No actual backup/restore was inspected or executed, and restore success handling is unsafe (F25). |
| 14. What must be fixed before production use? | **P0 consistency, unit/quantity tracking, claims, replacement and permission defects first; P1 UI, validation, history/documents, supplier layers, reporting and recovery next.** Then run the isolated database/browser/concurrency/security/restore acceptance gates in Section 23. |

Audit deliverable only: POS_WARRANTY_AUDIT.md. This auditor modified no application, migration, configuration, dependency, production record or container. Independently appearing working-tree changes are qualified at the start of this report and in F22.

