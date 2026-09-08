import { apiGet, apiGetWithMeta } from './http';

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
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
