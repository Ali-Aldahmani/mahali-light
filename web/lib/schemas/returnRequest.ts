import { z } from 'zod';
import { validateMoneyResponse } from './invoice';

const money = z.number();

// Mirrors server/controllers/returnRequestsController.js shapeRequest() —
// money fields (totalValue, item line values) are what matter for MED-07;
// refundPlan/replacementPlan stay loose (JSON blobs vary by return type).
export const returnRequestSchema = z.object({
  id: z.string(),
  requestNumber: z.string(),
  returnType: z.string(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),
  status: z.string(),
  refundPlan: z.any(),
  replacementPlan: z.any(),
  totalValue: money.optional(),
  itemCount: z.number().int().nonnegative().optional(),
});

export const returnRequestItemSchema = z.object({
  id: z.string(),
  productId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  invoiceItemId: z.string().nullable().optional(),
  productName: z.string().nullable().optional(),
  quantity: money,
  unitLabel: z.string().nullable().optional(),
  unitPrice: money,
  totalValue: money,
  condition: z.string().optional(),
  serialNumber: z.string().nullable().optional(),
  warrantyId: z.string().nullable().optional(),
});

export const returnRequestDetailSchema = returnRequestSchema.extend({
  items: z.array(returnRequestItemSchema),
  history: z.array(z.any()).optional(),
  order: z
    .object({
      id: z.string(),
      returnOrderNumber: z.string(),
      totalValue: money,
      refundTotal: money,
      replacementInvoiceId: z.string().nullable().optional(),
      createdAt: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const returnLookupItemSchema = z.object({
  id: z.string(),
  productId: z.string().nullable().optional(),
  variantId: z.string().nullable().optional(),
  productName: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  unitLabel: z.string().nullable().optional(),
  quantity: money,
  unitPrice: money,
  refundableLineValue: money.optional(),
  lineTotal: money,
  serialNumber: z.string().nullable().optional(),
  committedReturnQty: money.optional(),
  committedReturnValue: money.optional(),
  availableQty: money.optional(),
});

export const returnLookupInvoiceSchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  createdAt: z.string().optional(),
  total: money,
  status: z.string(),
  paymentStatus: z.string().nullable().optional(),
  hasReturn: z.boolean().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  cashierUsername: z.string().nullable().optional(),
  items: z.array(returnLookupItemSchema),
});

export const returnLookupResponseSchema = z.array(returnLookupInvoiceSchema);

export type ReturnRequest = z.infer<typeof returnRequestSchema>;
export type ReturnRequestDetail = z.infer<typeof returnRequestDetailSchema>;
export type ReturnLookupInvoice = z.infer<typeof returnLookupInvoiceSchema>;
export { validateMoneyResponse };
