import { apiDelete, apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

export async function listUsers({ page = 1, limit = 20, search = '', isActive } = {}) {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', limit);
  if (search) params.set('search', search);
  if (isActive !== undefined && isActive !== null && isActive !== '') {
    params.set('isActive', isActive);
  }
  return apiGetWithMeta(`/users?${params.toString()}`);
}

export function getUser(id) {
  return apiGet(`/users/${id}`);
}

export function createUser(payload) {
  return apiPost('/users', payload);
}

export function updateUser(id, payload) {
  return apiPut(`/users/${id}`, payload);
}

export function deactivateUser(id) {
  return apiDelete(`/users/${id}`);
}

export function forceLogout(id) {
  return apiPost(`/users/${id}/force-logout`);
}
