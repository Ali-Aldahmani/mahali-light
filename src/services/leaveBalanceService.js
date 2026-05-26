import { apiGet, apiPost, apiPut } from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function listAllBalances(year) {
  return apiGet(`/leave-balances${qs({ year })}`);
}

export function getEmployeeBalances(employeeId, year) {
  return apiGet(`/leave-balances/${employeeId}${qs({ year })}`);
}

export function updateEmployeeBalances(employeeId, year, payload) {
  return apiPut(`/leave-balances/${employeeId}`, { year, payload });
}

export function carryOverYear(fromYear, toYear) {
  return apiPost('/leave-balances/carry-over', { fromYear, toYear });
}
