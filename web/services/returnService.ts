import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http';
import {
  returnRequestSchema,
  validateMoneyResponse,
  type ReturnRequest,
} from '@/lib/schemas/returnRequest';

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listReturnRequests(filters = {}) {
  return apiGetWithMeta(`/return-requests?${toParams(filters)}`);
}

export function getReturnRequest(id) {
  return apiGet(`/return-requests/${id}`);
}

export async function createReturnRequest(body): Promise<ReturnRequest> {
  const data = await apiPost('/return-requests', body);
  return validateMoneyResponse(returnRequestSchema, data, 'POST /return-requests');
}

export async function approveReturnRequest(id, notes = null): Promise<ReturnRequest> {
  const data = await apiPut(`/return-requests/${id}/approve`, { notes });
  return validateMoneyResponse(returnRequestSchema, data, `PUT /return-requests/${id}/approve`);
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
