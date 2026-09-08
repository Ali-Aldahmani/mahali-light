import { apiDelete, apiGet, apiPost, apiPut } from './http';

export function listAttributes() {
  return apiGet('/attributes');
}

export function createAttribute(payload) {
  return apiPost('/attributes', payload);
}

export function updateAttribute(id, payload) {
  return apiPut(`/attributes/${id}`, payload);
}

export function addAttributeValue(id: string | number, value: string, sortOrder?: number) {
  return apiPost(`/attributes/${id}/values`, { value, sortOrder });
}

export function removeAttributeValue(id, valueId) {
  return apiDelete(`/attributes/${id}/values/${valueId}`);
}

export function reorderAttributeValues(id, values) {
  return apiPut(`/attributes/${id}/values`, { values });
}
