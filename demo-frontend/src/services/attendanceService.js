import { apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function getTodayAttendance() {
  return apiGet('/attendance/today');
}

export function listAttendance(params) {
  return apiGetWithMeta(`/attendance${qs(params)}`);
}

export function getMonthlySheet({ month, year, employeeId }) {
  return apiGet(`/attendance/monthly${qs({ month, year, employeeId })}`);
}

export function getEmployeeHistory(employeeId, params) {
  return apiGetWithMeta(`/attendance/${employeeId}${qs(params)}`);
}

export function getEmployeeSummary(employeeId, { month, year }) {
  return apiGet(`/attendance/${employeeId}/summary${qs({ month, year })}`);
}

export function createManualAttendance(payload) {
  return apiPost('/attendance', payload);
}

export function updateAttendance(id, payload) {
  return apiPut(`/attendance/${id}`, payload);
}

export function listCorrections(params) {
  return apiGetWithMeta(`/attendance/corrections${qs(params)}`);
}

export function submitCorrection(payload) {
  return apiPost('/attendance/corrections', payload);
}

export function approveCorrection(id) {
  return apiPut(`/attendance/corrections/${id}/approve`, {});
}

export function rejectCorrection(id, rejectionReason) {
  return apiPut(`/attendance/corrections/${id}/reject`, { rejectionReason });
}
