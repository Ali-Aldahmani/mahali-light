import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http';

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listWarranties(filters = {}) {
  return apiGetWithMeta(`/warranties?${toParams(filters)}`);
}

export function getWarranty(id) {
  return apiGet(`/warranties/${id}`);
}

export function createWarranty(body) {
  return apiPost('/warranties', body);
}

export function updateWarranty(id, body) {
  return apiPut(`/warranties/${id}`, body);
}

export function voidWarranty(id: string | number, reason?: string) {
  return apiPost(`/warranties/${id}/void`, { reason });
}

export function lookupWarranties(q) {
  return apiGet(`/warranties/lookup?${toParams({ q })}`);
}

export function getWarrantySummary() {
  return apiGet('/warranties/summary');
}

export function listCustomerWarranties(customerId) {
  return apiGet(`/customers/${customerId}/warranties`);
}

export function getProductWarrantyStats(productId) {
  return apiGet(`/warranties/product-stats/${productId}`);
}
