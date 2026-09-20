import { z } from 'zod';
import { validateMoneyResponse } from './invoice';

// Mirrors server/controllers/returnRequestsController.js shapeRequest() —
// the money fields (totalValue, refundPlan) are what actually matter here
// (MED-07); refundPlan/replacementPlan are left loose since their internal
// shape is a JSON blob that varies by return type.
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
  totalValue: z.number().optional(),
  itemCount: z.number().optional(),
});

export type ReturnRequest = z.infer<typeof returnRequestSchema>;
export { validateMoneyResponse };
