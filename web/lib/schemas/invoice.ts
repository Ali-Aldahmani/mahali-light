import { z } from 'zod';

// Runtime validation for the money-bearing shapes the backend actually
// returns (server/controllers/invoicesController.js shapeInvoice/
// shapeItem/shapePayment) — TypeScript types are compile-time only and
// give zero guarantee about what a live network response actually
// contains. Scoped to invoices/payments/returns first (audit finding
// MED-07: near-universal `any` typing with no runtime validation
// anywhere in web/), not a blanket rewrite of every API response.
//
// nullable()/optional() below mirror the backend's own `|| null` /
// conditional-field behavior exactly — a stricter schema would start
// failing on legitimate responses.

export const invoiceItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  variantId: z.string(),
  productName: z.string(),
  variantAttributes: z.record(z.any()),
  sku: z.string(),
  unitLabel: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  discountPercent: z.number(),
  discountAmount: z.number(),
  lineSubtotal: z.number(),
  lineTotal: z.number(),
  position: z.number().nullable(),
  serialNumber: z.string().nullable(),
  costPriceAtTime: z.number().optional(),
});

export const invoicePaymentSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  method: z.string(),
  amount: z.number(),
  bankAccountId: z.string().nullable(),
  employeeId: z.string().nullable(),
  employeeUsername: z.string().nullable(),
  timestamp: z.string(),
  notes: z.string().nullable(),
});

export const invoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  customerCompany: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdByUsername: z.string().nullable(),
  confirmedBy: z.string().nullable(),
  confirmedByUsername: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledByUsername: z.string().nullable(),
  cancelReason: z.string().nullable(),
  pcIdentifier: z.string().nullable(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  status: z.string(),
  paymentStatus: z.string(),
  subtotal: z.number(),
  discountAmount: z.number(),
  invoiceDiscount: z.number(),
  taxableAmount: z.number(),
  taxRate: z.number(),
  taxAmount: z.number(),
  total: z.number(),
  amountPaid: z.number(),
  balanceDue: z.number(),
  hasReturn: z.boolean(),
  notes: z.string().nullable(),
  itemCount: z.number().optional(),
  customerCreditBalance: z.number().optional(),
});

// GET /invoices/:id response.
export const invoiceDetailSchema = z.object({
  invoice: invoiceSchema,
  items: z.array(invoiceItemSchema),
  payments: z.array(invoicePaymentSchema),
  editRequests: z.array(z.any()),
  history: z.array(z.any()),
});

// POST /invoices/:id/confirm — deliberately its own shape, not
// invoiceDetailSchema: it nests the invoice under `invoice` (not bare)
// and adds `totals`/`warranties` that create/cancel don't return.
export const invoiceConfirmSchema = z.object({
  invoice: invoiceSchema,
  items: z.array(invoiceItemSchema),
  payments: z.array(invoicePaymentSchema),
  totals: z.record(z.any()),
  warranties: z.array(z.any()),
});

// POST /invoices, POST /invoices/:id/cancel both return the bare shaped
// invoice (confirmed by reading the two controllers — no partial overlap
// with invoiceConfirmSchema's nested shape).
export const invoiceSummarySchema = invoiceSchema;

export const invoicePaymentListSchema = z.array(invoicePaymentSchema);

/**
 * Parses `data` against `schema`, returning it unchanged (typed) on
 * success. On a mismatch, logs the specific validation failure — which
 * means "the backend contract changed" or "a bug returned malformed
 * data" — and returns the raw value so a shape drift degrades to a
 * console warning instead of silently propagating bad money data through
 * the UI as `NaN`/`undefined` with no trace of why.
 */
export function validateMoneyResponse<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[validateMoneyResponse] ${context}: response shape mismatch`, result.error.issues, data);
    return data as T;
  }
  return result.data;
}
