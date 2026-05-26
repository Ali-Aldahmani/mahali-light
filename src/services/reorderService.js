import { apiGetWithMeta, apiPost, apiPut } from './http.js';

export function listReorderAlerts(status = 'pending') {
  return apiGetWithMeta(`/stock/reorder-alerts?status=${encodeURIComponent(status)}`);
}

export function dismissReorderAlert(id) {
  return apiPut(`/stock/reorder-alerts/${id}/dismiss`, {});
}

export function runReorderCheck() {
  return apiPost('/stock/reorder-alerts/check', {});
}
