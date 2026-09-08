import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http';

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listEditRequests({ status }: { status?: string } = {}) {
  return apiGetWithMeta(`/invoice-edit-requests?${toParams({ status })}`);
}

export function listForInvoice(invoiceId) {
  return apiGet(`/invoices/${invoiceId}/edit-requests`);
}

export function createEditRequest(invoiceId, body) {
  return apiPost(`/invoices/${invoiceId}/edit-request`, body);
}

export function approveEditRequest(invoiceId, requestId) {
  return apiPut(`/invoices/${invoiceId}/edit-request/${requestId}/approve`);
}

export function rejectEditRequest(invoiceId, requestId, reason) {
  return apiPut(`/invoices/${invoiceId}/edit-request/${requestId}/reject`, {
    reason,
  });
}
