import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

function toParams(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listAdjustments(filters = {}) {
  return apiGetWithMeta(`/stock/adjustments?${toParams(filters)}`);
}

export function getAdjustment(id) {
  return apiGet(`/stock/adjustments/${id}`);
}

export function createAdjustment(payload) {
  return apiPost('/stock/adjustments', payload);
}

export function approveAdjustment(id) {
  return apiPut(`/stock/adjustments/${id}/approve`, {});
}

export function rejectAdjustment(id, rejectionReason) {
  return apiPut(`/stock/adjustments/${id}/reject`, { rejectionReason });
}
