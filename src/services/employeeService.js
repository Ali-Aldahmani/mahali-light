import { apiDelete, apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

export async function listEmployees({ page = 1, limit = 20, search = '', isActive } = {}) {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', limit);
  if (search) params.set('search', search);
  if (isActive !== undefined && isActive !== null && isActive !== '') {
    params.set('isActive', isActive);
  }
  return apiGetWithMeta(`/employees?${params.toString()}`);
}

export function getEmployee(id) {
  return apiGet(`/employees/${id}`);
}

export function createEmployee(payload) {
  return apiPost('/employees', payload);
}

export function updateEmployee(id, payload) {
  return apiPut(`/employees/${id}`, payload);
}

export function deactivateEmployee(id) {
  return apiDelete(`/employees/${id}`);
}
