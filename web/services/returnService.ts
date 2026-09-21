import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http';
import { z } from 'zod';
import {
  returnRequestSchema,
  returnRequestDetailSchema,
  returnLookupResponseSchema,
  validateMoneyResponse,
  type ReturnRequest,
} from '@/lib/schemas/returnRequest';

const returnRequestListSchema = z.array(returnRequestSchema);

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export async function listReturnRequests(filters = {}) {
  const result = await apiGetWithMeta(`/return-requests?${toParams(filters)}`);
  validateMoneyResponse(returnRequestListSchema, result.data, 'GET /return-requests');
  return result;
}

export async function getReturnRequest(id) {
  const data = await apiGet(`/return-requests/${id}`);
  validateMoneyResponse(returnRequestDetailSchema, data, `GET /return-requests/${id}`);
  return data;
}

export async function lookupReturnTransaction({ q, mode = 'auto' }) {
  const data = await apiGet(`/return-requests/lookup?${toParams({ q, mode })}`);
  validateMoneyResponse(returnLookupResponseSchema, data, 'GET /return-requests/lookup');
  return data;
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

export function getReturnRequestSummary() {
  return apiGet('/return-requests/summary');
}

export function listCustomerReturns(customerId) {
  return apiGet(`/customers/${customerId}/returns`);
}

export function listSupplierReturns(supplierId) {
  return apiGet(`/suppliers/${supplierId}/returns`);
}
