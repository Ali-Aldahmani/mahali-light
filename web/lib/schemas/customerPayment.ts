import { z } from 'zod';

// Mirrors server/controllers/customerPaymentsController.js shape()
export const customerPaymentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  invoiceId: z.string().nullable().optional(),
  amount: z.number(),
  paymentMethod: z.string(),
  paymentDate: z.string().nullable().optional(),
  bankAccountId: z.string().nullable().optional(),
  employeeId: z.string().nullable().optional(),
  employeeUsername: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

export const customerPaymentCustomerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  creditBalance: z.number(),
});

export const collectPaymentResponseSchema = z.object({
  payment: customerPaymentSchema,
  customer: customerPaymentCustomerSchema,
});

export const voidPaymentResponseSchema = z.object({
  id: z.string(),
  customer: customerPaymentCustomerSchema,
});

export const customerPaymentListSchema = z.array(customerPaymentSchema);

export type CustomerPayment = z.infer<typeof customerPaymentSchema>;
export type CollectPaymentResponse = z.infer<typeof collectPaymentResponseSchema>;
export type VoidPaymentResponse = z.infer<typeof voidPaymentResponseSchema>;
