import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http';

function toParams(o: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listSupplierReturns({
  page = 1,
  limit = 25,
  supplierId,
  status,
}: {
  page?: number;
  limit?: number;
  supplierId?: string | number;
  status?: string;
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
