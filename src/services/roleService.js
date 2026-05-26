import { apiDelete, apiGet, apiPost, apiPut } from './http.js';

export function listRoles() {
  return apiGet('/roles');
}

export function getRole(id) {
  return apiGet(`/roles/${id}`);
}

export function createRole(payload) {
  return apiPost('/roles', payload);
}

export function updateRole(id, payload) {
  return apiPut(`/roles/${id}`, payload);
}

export function deleteRole(id) {
  return apiDelete(`/roles/${id}`);
}

export function setRolePermissions(id, permissionKeys) {
  return apiPut(`/roles/${id}/permissions`, { permissionKeys });
}

export function listAllPermissions() {
  return apiGet('/roles/permissions/all');
}
