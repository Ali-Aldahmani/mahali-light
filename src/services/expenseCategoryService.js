import { apiGet, apiPost, apiPut, apiDelete } from './http.js';

export function listCategories() {
  return apiGet('/expense-categories');
}

export function createCategory(body) {
  return apiPost('/expense-categories', body);
}

export function updateCategory(id, body) {
  return apiPut(`/expense-categories/${id}`, body);
}

export function deleteCategory(id) {
  return apiDelete(`/expense-categories/${id}`);
}
