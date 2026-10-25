# Record-Level Audit Log Implementation

## 1. Executive Summary

Implemented a reusable, read-only record-level audit viewer over Edara POS's existing `activity_log`. The implementation does not create a second event pipeline, rewrite history, or backfill missing events. It adds an allowlisted API, a separate audit-view permission, verified related-record resolution, recursive redaction, cursor pagination, a shared modal using the supplied Timeline interface, and contextual actions on existing record detail surfaces.

## 2. Existing Audit Infrastructure Discovered

- `activity_log` was created in `server/db/migrations/001_init.sql` with stable UUID event IDs, entity identity, actor ID, timestamp, old/new JSON, and notes.
- Migration 019 already provides timestamp and `(entity_type, entity_id, timestamp)` indexes.
- Migration 038 adds the event-time actor-name snapshot and a PostgreSQL trigger blocking ordinary updates and deletes.
- `server/utils/activityLog.js` is the single application event writer. Callers may provide their active transaction so the business mutation and audit insert commit or roll back together.
- Invoice, customer, product, supplier, purchase order, returns, inventory, finance, bill, warranty, user, role, attendance, and other workflows already emit activity rows. Existing capture was reused unchanged.
- Authentication uses JWT-backed sessions and server-side RBAC. This deployment has one store database and no tenant/company column; there is therefore no client-supplied tenant scope to trust.
- The application is LAN/server authoritative. Offline invoice retries use existing operation/idempotency mechanisms; this feature only reads committed server events.

## 3. Architecture Decisions

- Added `GET /api/audit/events` rather than record-specific duplicate endpoints.
- `entityType` resolves through a fixed server allowlist; it is never interpolated as an untrusted SQL identifier.
- Access requires `audit.view` and the selected record type's existing view permission.
- Each related resolver is tied to its own required permission and immutable database foreign keys.
- No name, description, or free-text matching is used for relationships.
- The API returns newest-first deterministic pages using `(timestamp, id)` cursors.
- The frontend fetches only when the modal is opened and cancels/ignores stale requests.

## 4. Supported Record Types

Implemented and exposed in existing record-level UI:

- Invoice
- Customer
- Supplier
- Product
- Category
- Purchase order
- Return request
- Return order
- Stock count
- Bill
- Journal entry
- Warranty
- Warranty claim

Not forced into list-only or nonexistent detail surfaces: one-time expenses, cash drawer sessions, stock-adjustment requests, users, roles, and employees. Their existing activity capture remains available for a future suitable detail surface.

## 5. Direct and Related Event Coverage

Direct events match exact `entity_type + entity_id`. Related events are resolved through existing foreign keys for invoices/returns/warranties, customers/invoices/returns/warranties, products/variants/adjustments/purchases/returns/warranties, suppliers/purchases/payments/returns/warranties, purchase orders/payments/returns/warranties, return request/order pairs, bills/payments, and warranty/claim pairs. Related categories are omitted automatically when the viewer lacks the related module's permission.

Historical rows that were never captured remain absent; no inferred events, actors, timestamps, or values are fabricated.

## 6. Files Created or Modified

Backend:

- `server/services/auditService.js`
- `server/controllers/auditController.js`
- `server/routes/audit.js`
- `server/index.js`
- `server/db/migrations/048_record_audit_permission.sql`
- `shared/permissions.js`
- `server/db/seed.js`

Frontend shared implementation:

- `web/services/auditService.ts`
- `web/components/audit/AuditLogButton.tsx`
- `web/components/audit/AuditLogModal.tsx`
- `web/components/ui/Timeline.tsx`
- `web/components/ui/timeline.module.css`
- `web/components/ui/Modal.tsx`

Record integrations:

- `web/app/(dashboard)/invoices/[id]/page.tsx`
- `web/app/(dashboard)/customers/[id]/page.tsx`
- `web/app/(dashboard)/suppliers/[id]/page.tsx`
- `web/app/(dashboard)/products/[id]/page.tsx`
- `web/app/(dashboard)/categories/page.tsx`
- `web/app/(dashboard)/purchase-orders/[id]/page.tsx`
- `web/app/(dashboard)/returns/requests/[id]/page.tsx`
- `web/app/(dashboard)/returns/orders/[id]/page.tsx`
- `web/app/(dashboard)/inventory/counts/[id]/page.tsx`
- `web/app/(dashboard)/expenses/bills/[id]/page.tsx`
- `web/components/finance/JournalPage.tsx`
- `web/app/(dashboard)/warranties/[id]/page.tsx`
- `web/app/(dashboard)/warranty-claims/[id]/page.tsx`

Tests:

- `tests/unit/auditService.test.js`
- `web/components/audit/AuditLogModal.test.tsx`

## 7. API Integration

`GET /api/audit/events` accepts validated `entityType`, UUID `entityId`, bounded `limit`, opaque `cursor`, `scope`, `action`, actor, date, and search filters. It returns normalized events plus record identity and the next cursor in response metadata. Queries are bounded to 100 rows, indexed, parameterized, and avoid per-event database requests.

## 8. Database Changes

Migration 048 adds only the `audit.view` permission and grants it to existing Admin and Manager system roles. It does not change business records or historical audit rows. Existing append-only and query indexes are reused; no speculative index was added.

## 9. Authorization and Data Isolation

- Authentication is mandatory.
- `audit.view` is mandatory independently of ordinary record access.
- The selected record's view permission and existence are verified server-side.
- Related entities are included only if their relationship and module permission are both verified.
- Unsupported entity types and invalid IDs are rejected.
- Sensitive JSON keys and obvious credential assignments in notes are redacted recursively.
- Cost fields require `product.view_cost`.
- Edara POS currently has no multi-company database scope; it is a single-store deployment. Cross-company guarantees cannot be implemented against a nonexistent tenant model and this limitation is explicit.

## 10. Audit Integrity and Immutability

No update/delete audit endpoint exists. Migration 038's database trigger continues to reject activity-row changes or deletion, apart from its narrow actor-FK nulling exception. Existing transactional event writers remain unchanged. This reader shows only committed activity rows.

## 11. Offline/LAN Considerations

History is read from the authoritative LAN server and does not display queued client work as committed activity. Existing command idempotency and transaction IDs remain responsible for retry behavior. The viewer adds no offline queue and cannot duplicate writes because it is read-only.

## 12. Performance Considerations

- Lazy modal loading
- 50-row default and 100-row hard maximum
- Deterministic cursor pagination
- Existing entity/time indexes
- One query per page, with set-based relationship resolution
- Abort/sequence protection against stale frontend responses
- No list-row prefetching

## 13. Automated Tests Executed

Tests cover allowlist integrity, recursive secret/cost redaction, note redaction, invalid cursors, modal loading, record identity, ordering, expandable comparisons, related filtering, pagination, errors, retry, RBAC catalog integrity, existing category behavior, and the wider frontend regression suite. The production Next.js build verifies all integrated detail pages.

## 14. Test Results and Failures

- `npm --prefix web run build`: passed.
- `npm --prefix web test`: 25 files, 205 tests passed.
- `npm test -- --run tests/unit/auditService.test.js tests/contracts/authz.contract.test.js`: 2 files, 20 tests passed.
- Existing PostgreSQL-backed audit/idempotency suites were selected but 41 tests were skipped because `INVOICE_TEST_PG_PORT` was not configured. No production database was used.
- Existing non-failing jsdom warnings remain in unrelated FileDropzone, NotificationCenter, and MobileApp tests.

## 15. Known Limitations

- Older operations not captured in `activity_log` cannot be reconstructed.
- Actor roles, correlation IDs, transaction IDs, source-system fields, and tenant IDs are not columns in the existing activity schema, so the UI does not invent them.
- Stock movements have their own authoritative ledger page; they are not synthesized into activity rows.
- No suitable record-detail UI currently exists for several list-only modules noted above.
- The action catalog is based on captured action strings; it cannot expose categories with no real data.

## 16. Missing Historical Data

Events predating a workflow's use of `logActivity`, actor-name snapshots predating migration 038, and before/after values omitted by historical writers remain unavailable and are presented as absent rather than inferred.

## 17. Future Recommendations

- Add first-class correlation/request IDs and actor-role snapshots to future audit events through an additive migration.
- Add organization/store scope only if Edara POS adopts a real multi-tenant data model.
- Add contextual audit actions when list-only modules gain stable detail views.
- Gradually move remaining best-effort mutation logs into their existing business transactions where operational policy requires strict atomicity.
