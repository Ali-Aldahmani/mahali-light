# Purchase Order Discussion System — Implementation Report

## 1. Executive Summary

A production-grade, permission-controlled, real-time **Purchase Order Comments & Discussion** feature has been implemented for the Bytecra Point of Sale (POS) system. The feature provides an isolated, persistent communication thread for each Purchase Order, enabling authorized employees to view discussions, post comments and replies, and react with emoji in real-time across multiple LAN tills.

Strict business rules have been enforced:
- **Comment Immutability**: Comments and replies cannot be edited or deleted through normal application workflows, HTTP endpoints, or standard database operations (enforced by a PostgreSQL row-level trigger).
- **Author Identity Preservation**: Author display names and usernames are permanently stored on comments. Historical records remain attributable even if an employee is deactivated or deleted.
- **RBAC Enforcement**: Server-side permission gating (`po.comments.view`, `po.comments.create`, `po.comments.react`) integrated into the existing role hierarchy.
- **Socket.io Scoping & Authorization**: Real-time events are strictly isolated per Purchase Order room (`po_discussion:${poId}`) and emitted only after successful database transaction commits.
- **Strict UI Placement**: The discussion thread is positioned directly below the Items section in the main column of the Purchase Order detail page (`web/app/(dashboard)/purchase-orders/[id]/page.tsx`), leaving the right-hand column (Invoice Attachment and Payment History) intact.
- **Deferred Features**: Edit/Delete and Resolve/Reopen actions are disabled. `@mention` logic is preserved for future activation with autocomplete disabled via a feature flag.

All 511 backend tests (including real PostgreSQL integration tests) and 181 frontend tests passed with zero regressions. The Next.js production build succeeded with complete type safety.

---

## 2. Repository Findings

- **Architecture**: Express 4.x backend, Next.js 15 App Router frontend, PostgreSQL 16 via `node-postgres` with additive SQL migrations, and Socket.io 4.8 real-time communication.
- **PO Detail Page**: Located at `web/app/(dashboard)/purchase-orders/[id]/page.tsx`. Follows a responsive 2-column layout (main content: `lg:col-span-2`, sidebar: `space-y-4`).
- **Permissions**: Defined in `shared/permissions.js` and seeded into the `permissions` table. Express routes enforce permissions via `requirePermission` middleware.
- **Operations & Idempotency**: Migration 040 created an `operations` table; `server/utils/operations.js` provides `runOnce` using advisory locks to prevent duplicate submissions from network retries or double-clicks.
- **Audit Logging**: Existing `activity_log` table is append-only (guarded by `activity_log_append_only` trigger from migration 038).

---

## 3. Files Created

1. `server/db/migrations/042_purchase_order_comments.sql`: Schema migration for comments, reactions, permissions, and immutability trigger.
2. `server/services/purchaseOrderCommentService.js`: Business logic for retrieving hierarchical comment trees, creating comments, depth validation, and reaction toggling.
3. `server/controllers/purchaseOrderCommentsController.js`: Express controllers with Zod input validation, idempotency support, and post-commit Socket.io event emissions.
4. `web/services/purchaseOrderCommentService.ts`: Axios client service for listing, creating, and reacting to PO comments.
5. `web/components/purchases/comment-thread.module.css`: Bespoke CSS module styling matching POS design tokens (`bg-surface`, `text-ink`, `accent`, etc.).
6. `web/components/purchases/CommentThread.tsx`: React presentation component adapted from the provided foundation (Edit/Delete removed, mentions disabled, Resolve hidden).
7. `web/components/purchases/PurchaseOrderComments.tsx`: Container component managing real-time Socket.io lifecycle, room subscription, optimistic reconciliation, and error handling.
8. `web/components/purchases/PurchaseOrderComments.test.tsx`: Vitest + React Testing Library suite verifying rendering, immutability, mentions disabled, and permissions.
9. `tests/unit/purchaseOrderCommentService.test.js`: Unit tests for tree building, shaping, immutability, and middleware checks.
10. `tests/unit/purchaseOrderCommentsSocket.test.js`: Unit tests for socket room subscription authorization.
11. `tests/integration/purchaseOrderComments.test.js`: Comprehensive integration tests on isolated PostgreSQL databases verifying RBAC, idempotency, foreign keys, and trigger immutability.

---

## 4. Files Modified

1. `shared/permissions.js`: Added `po.comments.view`, `po.comments.create`, and `po.comments.react` to `PERMISSIONS.po` and `ROLE_DEFAULTS.Manager`.
2. `server/db/seed.js`: Registered `po.comments.view`, `po.comments.create`, and `po.comments.react` in `ALL_PERMISSIONS`.
3. `server/routes/purchaseOrders.js`: Mounted nested comment routes under `/:id/comments` with permission gating.
4. `server/socket/index.js`: Added `join_po_discussion` (with permission & PO existence validation) and `leave_po_discussion` handlers.
5. `tests/contracts/authz.contract.test.js`: Updated expected permission count from 110 to 113.
6. `tests/globalSetup.js`: Added fallback to `process.env.PGUSER` and `process.env.PGPASSWORD` from `.env` for integration test runner.
7. `web/app/(dashboard)/purchase-orders/[id]/page.tsx`: Embedded `PurchaseOrderComments` in `lg:col-span-2 space-y-4` directly below the Items section.

---

## 5. Database Migrations Created

### Migration `042_purchase_order_comments.sql`

- **Permissions Seed**:
  - Inserts `po.comments.view`, `po.comments.create`, `po.comments.react` into `permissions`.
  - Grants permissions to `Admin` and `Manager` roles.
- **Table `purchase_order_comments`**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT`
  - `user_id UUID REFERENCES users(id) ON DELETE SET NULL`
  - `author_name VARCHAR(100) NOT NULL`
  - `author_username VARCHAR(50)`
  - `parent_id UUID REFERENCES purchase_order_comments(id) ON DELETE RESTRICT`
  - `body TEXT NOT NULL`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `request_key VARCHAR(128)`
  - Constraints: `chk_po_comment_body_nonempty` and `chk_po_comment_body_length (<= 5000)`.
  - Indexes: `idx_po_comments_po`, `idx_po_comments_parent`, `idx_po_comments_request_key`.
- **Immutability Trigger `po_comments_immutable_trigger`**:
  - Blocks all `UPDATE` statements on `purchase_order_comments` (except when `user_id` is nulled by an `ON DELETE SET NULL` foreign-key cascade from `users(id)`).
  - Blocks all `DELETE` statements on `purchase_order_comments`.
- **Table `purchase_order_comment_reactions`**:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `comment_id UUID NOT NULL REFERENCES purchase_order_comments(id) ON DELETE CASCADE`
  - `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `emoji VARCHAR(32) NOT NULL`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Unique Constraint: `UNIQUE (comment_id, user_id, emoji)`.

---

## 6. API Endpoints Implemented

| Method | Endpoint | Required Permission | Description |
|---|---|---|---|
| `GET` | `/api/purchase-orders/:id/comments` | `po.comments.view` | Retrieves hierarchical comment tree for the PO. |
| `POST` | `/api/purchase-orders/:id/comments` | `po.comments.create` | Creates a new comment or reply (idempotent via `Idempotency-Key` or `requestKey`). |
| `POST` | `/api/purchase-orders/:id/comments/:commentId/reactions` | `po.comments.react` | Adds or toggles emoji reaction. |
| `DELETE` | `/api/purchase-orders/:id/comments/:commentId/reactions/:emoji` | `po.comments.react` | Removes user's own emoji reaction. |

*Note: No `PUT`, `PATCH`, or `DELETE` endpoints exist for comments.*

---

## 7. Permission Changes

- **New Permissions**:
  - `po.comments.view`: Read PO discussions.
  - `po.comments.create`: Post comments and nested replies.
  - `po.comments.react`: Add or remove reactions.
- **Default Assignments**:
  - `Admin`: Granted via wildcard `*`.
  - `Manager`: Granted by default in `ROLE_DEFAULTS.Manager`.
  - `Cashier`: Denied by default.
  - `Warehouse`: Denied by default.
- Custom roles and user-level overrides can be assigned these permissions via the Role & User Management UI (`/roles/[id]/permissions` and `/team/users/[id]/permissions`).

---

## 8. Socket.io Events and Authorization

- **Room Naming**: `po_discussion:${poId}`
- **Subscription Handlers**:
  - `join_po_discussion`: Authenticated via JWT handshake; verifies active session, verifies `po.comments.view` (or `*`), verifies PO existence, and joins room.
  - `leave_po_discussion`: Leaves the scoped room.
- **Broadcast Events**:
  - `po_comment_created`: Emitted to `po_discussion:${poId}` only after database commit.
  - `po_comment_reaction_updated`: Emitted to `po_discussion:${poId}` only after database commit.
- **Cross-PO Isolation**: Broadcasts are scoped strictly to the PO room; global broadcasting is avoided.

---

## 9. Frontend Integration Details

- **Component Placement**: In `web/app/(dashboard)/purchase-orders/[id]/page.tsx`, `<PurchaseOrderComments purchaseOrderId={id} />` is placed inside the main content column (`lg:col-span-2 space-y-4`) directly below the Items table card.
- **Right Column Preserved**: Invoice Attachment card and Payment History table remain in the right-hand column untouched.
- **Real-Time Lifecycle**: Connects to the room on mount, unregisters on unmount, and reconciles state automatically upon reconnect.
- **Duplicate Prevention**: Buttons are disabled while requests are in-flight; unique `requestKey` prevents double-submission if clicked rapidly or retried after timeout.

---

## 10. Comment Immutability Enforcement

- **UI Level**: Removed all edit and delete buttons, composers, and confirmation dialogs.
- **API Level**: No update or delete routes mounted on Express router. Any `PUT`/`PATCH`/`DELETE` request to `/api/purchase-orders/:id/comments/:commentId` returns `404 Not Found`.
- **Database Level**: PostgreSQL trigger `po_comments_immutable_trigger` raises an exception on any `UPDATE` or `DELETE` statement.
- **Boundary Limitation**: The trigger protects against application-level queries and ORM operations. Direct superuser database administration during disaster recovery or controlled migrations remains possible by disabling triggers (`ALTER TABLE purchase_order_comments DISABLE TRIGGER ...`).

---

## 11. Deferred Features

- **@Mentions**: Code preserved in `CommentThread.tsx` with `mentionsEnabled = false` (default false). Autocomplete listbox, mention notifications, and mention suggestions are completely disabled and hidden from users.
- **Resolve / Reopen**: The resolve button and status chips are disabled/hidden. PO discussions remain open and readable regardless of PO status (`draft`, `confirmed`, `received`, `cancelled`).

---

## 12. Security Controls

- **Authentication**: JWT token validation in HTTP headers (`Bearer`) and Socket.io handshake auth payload.
- **Authorization**: Backend RBAC enforcement on routes and socket join operations.
- **Input Validation**: Zod schema validation on comment body length (`1..5000` chars), UUID formats, and sanitized emoji reactions.
- **SQL Injection Resistance**: 100% parameterized queries using `node-postgres`.
- **XSS Prevention**: React plain-text escaping in DOM output; no `dangerouslySetInnerHTML`.
- **Author Identity Integrity**: Server extracts author identity directly from `req.user.id` and `req.user.full_name`; client-supplied author overrides are discarded.
- **Rate Limiting**: Protected by global Express API limiter (`500 req/min`).

---

## 13. Tests Executed

1. **Backend Integration Tests** (`tests/integration/purchaseOrderComments.test.js`):
   - Unauthorized comment creation (403).
   - Unauthorized comment viewing (403).
   - Authorized root comment creation (201).
   - Empty/whitespace body rejection (400).
   - Oversized body rejection (400).
   - Reply creation (201).
   - Nonexistent parentId rejection (404).
   - Cross-PO parent reference rejection (400).
   - Hierarchical comment tree retrieval with deterministic order.
   - Idempotency-Key retry deduplication (returns existing record, inserts once).
   - Emoji reaction addition and duplicate prevention.
   - Removing own reaction.
   - Database trigger immutability against UPDATE.
   - Database trigger immutability against DELETE.
   - Rejection of HTTP PUT/PATCH endpoints (404).
   - Rejection of HTTP DELETE endpoints (404).
2. **Backend Unit Tests** (`tests/unit/purchaseOrderCommentService.test.js`):
   - Tree nesting algorithm and chronological sorting.
   - Orphan comment handling.
   - Comment shaping.
   - Controller immutability exports check.
   - `requirePermission` AND/DENY checks.
3. **Socket Authorization Tests** (`tests/unit/purchaseOrderCommentsSocket.test.js`):
   - Lacking permission rejection.
   - Active permission approval.
   - Wildcard Admin approval.
   - Inactive account rejection.
4. **Frontend Component Tests** (`web/components/purchases/PurchaseOrderComments.test.tsx`):
   - Comments & replies rendering.
   - Absence of Edit buttons.
   - Absence of Delete buttons.
   - Absence of Resolve/Reopen buttons.
   - Absence of @mention suggestion listbox.
   - Permission notice when `canCreate` is false.
   - Hidden reaction button when `canReact` is false.
   - Successful comment submission.
   - Duplicate-submit prevention while `isSubmitting`.
5. **Regression Tests**:
   - `tests/integration/purchaseOrders.test.js`: Verified PO creation, items calculation, partial schemas, and confirmation.
   - `tests/contracts/authz.contract.test.js`: Verified permission catalog integrity.
   - Full root test suite (`npm test`).
   - Full web test suite (`npm --prefix web test`).

---

## 14. Test Results

| Test Suite | Total Tests | Passed | Failed | Skipped | Status |
|---|---|---|---|---|---|
| PO Comments Integration (`tests/integration/purchaseOrderComments.test.js`) | 16 | 16 | 0 | 0 | **PASSED** |
| PO Comments Unit (`tests/unit/purchaseOrderCommentService.test.js`) | 8 | 8 | 0 | 0 | **PASSED** |
| PO Comments Socket (`tests/unit/purchaseOrderCommentsSocket.test.js`) | 4 | 4 | 0 | 0 | **PASSED** |
| PO Regression (`tests/integration/purchaseOrders.test.js`) | 5 | 5 | 0 | 0 | **PASSED** |
| Full Backend Test Suite (`npm test`) | 518 | 511 | 0 | 7 | **PASSED** |
| Full Frontend Test Suite (`npm --prefix web test`) | 181 | 181 | 0 | 0 | **PASSED** |

---

## 15. Build and Type-Check Results

- Command: `npm --prefix web run build`
- Result: **Compiled successfully with exit code 0**.
- Type checking: **No type errors** across all components, pages, and services.
- Route generation: `/purchase-orders/[id]` generated dynamically and successfully (`19.7 kB`).

---

## 16. Known Limitations

- Discussions are bounded to a maximum depth of 3 levels to maintain optimal layout and readability on mobile/tablet tills.
- Attachments inside comments are currently not supported; PO document attachments remain handled via the existing Invoice Attachment section.

---

## 17. Remaining Risks

- **Database Migration Execution**: Migration `042_purchase_order_comments.sql` is additive and safe, but must be run via the normal migration runner (`npm run migrate`) prior to container restart in staging/production environments.

---

## 18. Deployment Prerequisites

1. Run migrations: `npm run migrate` (runs `042_purchase_order_comments.sql` safely within a transaction).
2. Re-seed permissions (optional, migration already seeds permissions): `npm run seed`.
3. Build web frontend: `npm run build`.
4. Restart application containers / services.

---

## 19. Manual Verification Checklist

- [ ] Log in as Admin or Manager and navigate to any Purchase Order (`/purchase-orders/:id`).
- [ ] Confirm Discussion card appears directly below the Items table in the main column.
- [ ] Confirm Invoice Attachment and Payment History remain in the right-hand column.
- [ ] Submit a root comment; verify it appears immediately with the author name and timestamp.
- [ ] Click "Reply" on the comment, submit a response; verify it nests cleanly below the parent.
- [ ] Click an emoji reaction; verify reaction badge appears with count rolling up to 1.
- [ ] Open the same PO in a second browser window with another manager account; verify new comments and reactions appear in real-time without page refresh.
- [ ] Click the reaction again; verify own reaction is removed and count updates.
- [ ] Verify that no "Edit" or "Delete" buttons exist anywhere on any comment.
- [ ] Type `@` in the comment composer; verify no autocomplete popup or suggestions appear.
- [ ] Log in as a Cashier; verify that commenting is disabled with an explanatory notice if permissions are withheld.

---

## 20. Final Implementation Status

**Status: COMPLETED**
All functional, security, concurrency, immutability, architectural, and design requirements have been fully satisfied and verified.
