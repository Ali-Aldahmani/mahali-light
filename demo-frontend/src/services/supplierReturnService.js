import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

function toParams(o) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listSupplierReturns({
  page = 1,
  limit = 25,
  supplierId,
  status,
} = {}) {
  return apiGetWithMeta(
    `/supplier-returns?${toParams({ page, limit, supplierId, status })}`,
  );
}

export function getSupplierReturn(id) {
  return apiGet(`/supplier-returns/${id}`);
}

export function createSupplierReturn(body) {
  return apiPost('/supplier-returns', body);
}

export function resolveSupplierReturn(id, body) {
  return apiPut(`/supplier-returns/${id}/resolve`, body);
}
