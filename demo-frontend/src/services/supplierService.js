import { apiGet, apiGetWithMeta, apiPost, apiPut, apiDelete } from './http.js';

function toParams(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listSuppliers({
  page = 1,
  limit = 25,
  search,
  isActive,
} = {}) {
  return apiGetWithMeta(
    `/suppliers?${toParams({ page, limit, search, isActive })}`,
  );
}

export function getSupplier(id) {
  return apiGet(`/suppliers/${id}`);
}

export function createSupplier(body) {
  return apiPost('/suppliers', body);
}

export function updateSupplier(id, body) {
  return apiPut(`/suppliers/${id}`, body);
}

export function deactivateSupplier(id) {
  return apiDelete(`/suppliers/${id}`);
}

export function getSupplierPurchaseOrders(id) {
  return apiGet(`/suppliers/${id}/purchase-orders`);
}

export function getSupplierPayments(id) {
  return apiGet(`/suppliers/${id}/payments`);
}

export function getSupplierProducts(id) {
  return apiGet(`/suppliers/${id}/products`);
}

export function getSupplierReturns(id) {
  return apiGet(`/suppliers/${id}/returns`);
}

export function getSupplierTimeline(id) {
  return apiGet(`/suppliers/${id}/timeline`);
}
