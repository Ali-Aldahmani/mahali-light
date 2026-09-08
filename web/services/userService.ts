import { apiDelete, apiGet, apiGetWithMeta, apiPost, apiPut } from './http';

export async function listUsers({
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
  return apiGetWithMeta(`/users?${params.toString()}`);
}

export function getUser(id: string | number) {
  return apiGet(`/users/${id}`);
}

export function createUser(payload: any) {
  return apiPost('/users', payload);
}

export function updateUser(id: string | number, payload: any) {
  return apiPut(`/users/${id}`, payload);
}

export function deactivateUser(id: string | number) {
  return apiDelete(`/users/${id}`);
}

export function forceLogout(id: string | number) {
  return apiPost(`/users/${id}/force-logout`);
}

export function getUserPermissions(id: string | number) {
  return apiGet(`/users/${id}/permissions`);
}

export function setUserPermissions(id: string | number, effectiveKeys: string[]) {
  return apiPut(`/users/${id}/permissions`, { effectiveKeys });
}
