import { apiDelete, apiGet, apiPost, apiPut } from './http.js';

export function listCategoriesTree() {
  return apiGet('/categories');
}

export function listCategoriesFlat() {
  return apiGet('/categories/flat');
}

export function getCategory(id) {
  return apiGet(`/categories/${id}`);
}

export function createCategory(payload) {
  return apiPost('/categories', payload);
}

export function updateCategory(id, payload) {
  return apiPut(`/categories/${id}`, payload);
}

export function deleteCategory(id) {
  return apiDelete(`/categories/${id}`);
}

export function getCategoryAttributes(id) {
  return apiGet(`/categories/${id}/attributes`);
}

export function setCategoryAttributes(id, attributes) {
  return apiPut(`/categories/${id}/attributes`, { attributes });
}
