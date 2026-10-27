import {
  apiGet,
  apiGetWithMeta,
  apiPost,
  apiPut,
  apiDelete,
} from './http';
import {
  invoiceDetailSchema,
  invoiceConfirmSchema,
  invoiceSummarySchema,
  invoicePaymentListSchema,
  invoicePaymentSchema,
  validateMoneyResponse,
  type invoiceSchema,
} from '@/lib/schemas/invoice';
import type { z } from 'zod';

export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export type InvoiceConfirmResult = z.infer<typeof invoiceConfirmSchema>;
export type InvoiceSummary = z.infer<typeof invoiceSchema>;
export type InvoicePayment = z.infer<typeof invoicePaymentSchema>;

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listInvoices(filters = {}) {
  return apiGetWithMeta(`/invoices?${toParams(filters)}`);
}

export async function getInvoice(id): Promise<InvoiceDetail> {
  const data = await apiGet(`/invoices/${id}`);
  return validateMoneyResponse(invoiceDetailSchema, data, `GET /invoices/${id}`);
}

export async function createInvoice(body): Promise<InvoiceSummary> {
  const data = await apiPost('/invoices', body);
  return validateMoneyResponse(invoiceSummarySchema, data, 'POST /invoices');
}

export interface CheckoutStatus {
  /** 'none' (no invoice yet), 'draft', 'confirmed' or 'cancelled'. */
  status: string;
  invoice: InvoiceSummary | null;
  warranties: any[];
}

// What happened to a sale attempt whose response never arrived.
export async function getCheckoutStatus(checkoutId: string): Promise<CheckoutStatus> {
  const data: any = await apiGet(`/invoices/checkout/${encodeURIComponent(checkoutId)}`);
  return {
    status: data?.status || 'none',
    invoice: data?.invoice
      ? validateMoneyResponse(invoiceSummarySchema, data.invoice, 'GET /invoices/checkout/:id')
      : null,
    warranties: data?.warranties || [],
  };
}

export function updateInvoiceItems(id, body) {
  return apiPut(`/invoices/${id}/items`, body);
}

// Makes another cashier's draft sale this user's (logged on the server).
export function takeOverInvoice(id: string) {
  return apiPost(`/invoices/${id}/take-over`, {});
}

// closedDrawerReason: a manager taking cash with the drawer closed (SI-06).
export async function confirmInvoice(id, closedDrawerReason?: string | null): Promise<InvoiceConfirmResult> {
  const data = await apiPost(`/invoices/${id}/confirm`,
    closedDrawerReason ? { closedDrawerOverride: { reason: closedDrawerReason } } : {});
  return validateMoneyResponse(invoiceConfirmSchema, data, `POST /invoices/${id}/confirm`);
}

export async function cancelInvoice(id, reason): Promise<InvoiceSummary> {
  const data = await apiPost(`/invoices/${id}/cancel`, { reason });
  return validateMoneyResponse(invoiceSummarySchema, data, `POST /invoices/${id}/cancel`);
}

export async function addInvoicePayment(id, body): Promise<InvoicePayment> {
  const data = await apiPost(`/invoices/${id}/payments`, body);
  return validateMoneyResponse(invoicePaymentSchema, data, `POST /invoices/${id}/payments`);
}

// Takes an allocation off a draft (it has no financial effect until the
// invoice is confirmed); the server refuses it on a confirmed invoice.
export function removeInvoicePayment(id: string, paymentId: string) {
  return apiDelete(`/invoices/${id}/payments/${paymentId}`);
}

export async function getInvoicePayments(id): Promise<InvoicePayment[]> {
  const data = await apiGet(`/invoices/${id}/payments`);
  return validateMoneyResponse(invoicePaymentListSchema, data, `GET /invoices/${id}/payments`);
}

export function nextInvoiceNumber(pcIdentifier) {
  return apiGet(`/invoices/next-number?${toParams({ pcIdentifier })}`);
}
