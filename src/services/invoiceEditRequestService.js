import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

function toParams(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listEditRequests({ status } = {}) {
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
