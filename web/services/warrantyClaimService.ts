import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http';

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listClaims(filters = {}) {
  return apiGetWithMeta(`/warranty-claims?${toParams(filters)}`);
}

export function getClaim(id) {
  return apiGet(`/warranty-claims/${id}`);
}

export function createClaim(body) {
  return apiPost('/warranty-claims', body);
}

export function updateClaim(id, body) {
  return apiPut(`/warranty-claims/${id}`, body);
}

export function resolveClaim(id, body) {
  return apiPost(`/warranty-claims/${id}/resolve`, body);
}

export function raiseSupplierClaim(id: string | number, notes?: string) {
  return apiPost(`/warranty-claims/${id}/raise-supplier-claim`, { notes });
}

export function setSupplierClaimResolved(id: string | number, resolved: boolean, notes?: string) {
  return apiPost(`/warranty-claims/${id}/supplier-resolved`, {
    resolved,
    notes,
  });
}

export function getClaimsSummary() {
  return apiGet('/warranty-claims/summary');
}
