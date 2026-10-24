import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http';
import { withRequestKey } from '@/lib/requestKey';

function toParams(o: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listAdjustments(filters = {}) {
  return apiGetWithMeta(`/stock/adjustments?${toParams(filters)}`);
}

export function getAdjustment(id) {
  return apiGet(`/stock/adjustments/${id}`);
}

// requestKey: see lib/requestKey — a retried direct adjustment can't move stock twice.
export function createAdjustment(payload, requestKey?: string) {
  return apiPost('/stock/adjustments', payload, withRequestKey(requestKey));
}

export function approveAdjustment(id) {
  return apiPut(`/stock/adjustments/${id}/approve`, {});
}

export function rejectAdjustment(id, rejectionReason) {
  return apiPut(`/stock/adjustments/${id}/reject`, { rejectionReason });
}
