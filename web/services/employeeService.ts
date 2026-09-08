import { apiDelete, apiGet, apiGetWithMeta, apiPost, apiPut } from './http';

export async function listEmployees({
  page = 1,
  limit = 20,
  search = '',
  isActive,
}: { page?: number; limit?: number; search?: string; isActive?: boolean | string } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (search) params.set('search', search);
  if (isActive !== undefined && isActive !== null && isActive !== '') {
    params.set('isActive', String(isActive));
  }
  return apiGetWithMeta(`/employees?${params.toString()}`);
}

export function getEmployee(id: string | number) {
  return apiGet(`/employees/${id}`);
}

export function createEmployee(payload: any) {
  return apiPost('/employees', payload);
}

export function updateEmployee(id: string | number, payload: any) {
  return apiPut(`/employees/${id}`, payload);
}

export function deactivateEmployee(id: string | number) {
  return apiDelete(`/employees/${id}`);
}
