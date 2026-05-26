import { apiGet, apiGetWithMeta } from './http.js';

function toParams(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listReturnOrders(filters = {}) {
  return apiGetWithMeta(`/return-orders?${toParams(filters)}`);
}

export function getReturnOrder(id) {
  return apiGet(`/return-orders/${id}`);
}

export function getReturnOrderSummary() {
  return apiGet('/return-orders/summary');
}
