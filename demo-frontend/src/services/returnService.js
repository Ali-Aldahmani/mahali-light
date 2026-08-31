import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

function toParams(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listReturnRequests(filters = {}) {
  return apiGetWithMeta(`/return-requests?${toParams(filters)}`);
}

export function getReturnRequest(id) {
  return apiGet(`/return-requests/${id}`);
}

export function createReturnRequest(body) {
  return apiPost('/return-requests', body);
}

export function approveReturnRequest(id, notes = null) {
  return apiPut(`/return-requests/${id}/approve`, { notes });
}

export function rejectReturnRequest(id, rejectionReason) {
  return apiPut(`/return-requests/${id}/reject`, { rejectionReason });
}

export function cancelReturnRequest(id) {
  return apiPut(`/return-requests/${id}/cancel`, {});
}

export function lookupReturnTransaction({ q, mode = 'auto' }) {
  return apiGet(`/return-requests/lookup?${toParams({ q, mode })}`);
}

export function getReturnRequestSummary() {
  return apiGet('/return-requests/summary');
}

export function listCustomerReturns(customerId) {
  return apiGet(`/customers/${customerId}/returns`);
}

export function listSupplierReturns(supplierId) {
  return apiGet(`/suppliers/${supplierId}/returns`);
}
