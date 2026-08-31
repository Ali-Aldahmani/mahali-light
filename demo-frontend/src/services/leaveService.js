import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function listLeaves(params) {
  return apiGetWithMeta(`/leaves${qs(params)}`);
}

export function getLeave(id) {
  return apiGet(`/leaves/${id}`);
}

export function submitLeave(payload) {
  return apiPost('/leaves', payload);
}

export function approveLeave(id) {
  return apiPut(`/leaves/${id}/approve`, {});
}

export function rejectLeave(id, rejectionReason) {
  return apiPut(`/leaves/${id}/reject`, { rejectionReason });
}

export function cancelLeave(id) {
  return apiPut(`/leaves/${id}/cancel`, {});
}

export function calculateLeaveDays({ startDate, endDate }) {
  return apiGet(`/leaves/calculate-days${qs({ startDate, endDate })}`);
}
