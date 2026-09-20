# Invoice integrity and private uploads

This change addresses findings F1–F10 in the Express API and its Next.js callers.
Existing historical accounting discrepancies are not rewritten automatically.

## Behavior

- Cancellation reverses actual cash and bank postings in the same transaction as
  stock, customer credit and the journal. It uses the original bank accounts even
  if the default account changed. Insufficient drawer cash or a closed accounting
  period rolls back the entire operation. Previously collected credit must be
  settled through a return/refund when the remaining debt cannot cover reversal.
- New invoice payment requests require `idempotencyKey` in the JSON body, or an
  `Idempotency-Key` header, with a maximum of 128 characters. Keep the same key and
  payload for retries. A matching retry returns the original payment; conflicting
  reuse returns 409. Keys are scoped to an invoice and backed by a unique index.
- Payments are draft allocations, capped at the remaining total. Confirmation
  requires full allocation to cash, bank or customer credit. Credit collections
  use the customer-payment workflow. POS cash tender is reduced by change before
  recording the payment; an unpaid registered-customer balance is allocated to credit.
- Approved confirmed-invoice corrections may change items and costs while
  preserving the settled total. New variants receive invoice lines, stock changes
  and journal entries. Total-changing edits are rejected atomically: use a return
  or cancel and reissue, since the edit form has no collection/refund instructions.
  Notes-only edits remain supported. Pending or approved returns block financial
  edits and cancellation of their invoice.
- Refund values use the original discounted lines, proportional invoice discount
  and tax, with cent allocation preserving the original invoice total. Approval
  validates the payout plan again. Old requests that exceed their discounted
  entitlement must be rejected and recreated. An empty plan cannot approve a
  positive-value refund. A genuinely zero-value return needs no monetary payout.
- Replacement differences are computed by the server from the returned value and
  replacement lines. Under the existing net-difference exchange model, additional
  payment is cash and receives treasury and sale postings; cheaper replacements
  execute their validated refund plans. Replacement COGS and original returned
  inventory costs are posted, including exchanges with no additional payment.
- Customer credit-limit checks lock the customer row. Return reservation and
  approval lock the source invoice and its lines before reading committed returns.
- `/files` publicly serves only product WebP images and the store logo. Private
  purchase documents, receipts and bug screenshots require a valid bearer session
  and the corresponding permission. Their browser callers use authenticated blob
  downloads, without tokens in URLs. Generated PDFs use the existing permission-
  gated invoice, receipt, purchase-order and report API routes.

## Migration and verification

Apply migration `025_invoice_payment_idempotency.sql` with the normal migration
command (`npm run migrate`, or the Docker command in README). Historical payment
keys remain null; deploy the updated frontend and backend together.

The real PostgreSQL regression suite creates a fresh database with a unique
`invoice_regression_` name and drops only that database afterwards. It requires a
local PostgreSQL test server and a test user allowed to create databases. It does
not load production connection settings from `.env`.

```powershell
$env:INVOICE_TEST_PG_PORT = '55439' # port of your local test server
$env:INVOICE_TEST_PG_USER = 'postgres'
# Set INVOICE_TEST_PG_PASSWORD if the test server requires one.
npx vitest run tests/integration/invoiceIntegrity.test.js
npx vitest run tests/unit/invoiceService.test.js tests/unit/refundAmounts.test.js tests/contracts/concurrency.locks.test.js
node web/node_modules/typescript/bin/tsc --noEmit --incremental false -p web/tsconfig.json
```

The integration tests use real SQL transactions, journals, treasury, inventory,
authentication and permissions. Only background PDF rendering is stubbed.
