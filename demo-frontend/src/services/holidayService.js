import { apiDelete, apiGet, apiPost } from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function listHolidays(params) {
  return apiGet(`/holidays${qs(params)}`);
}

export function addHoliday(payload) {
  return apiPost('/holidays', payload);
}

export function removeHoliday(id) {
  return apiDelete(`/holidays/${id}`);
}
