import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

export function listCounts(filters = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  return apiGetWithMeta(`/stock/counts?${p.toString()}`);
}

export function getCount(id) {
  return apiGet(`/stock/counts/${id}`);
}

export function createCount(payload) {
  return apiPost('/stock/counts', payload);
}

export function updateCountItems(id, items) {
  return apiPut(`/stock/counts/${id}/items`, { items });
}

export function submitCount(id) {
  return apiPost(`/stock/counts/${id}/submit`, {});
}

export function approveCount(id) {
  return apiPut(`/stock/counts/${id}/approve`, {});
}

export function rejectCount(id, rejectionReason) {
  return apiPut(`/stock/counts/${id}/reject`, { rejectionReason });
}
