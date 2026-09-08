import { apiDelete, apiGet, apiPost } from './http';

function qs(params: Record<string, any>): string {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
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
