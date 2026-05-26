import http, { apiDelete, apiGet, apiGetWithMeta, apiPost, apiPut } from './http.js';

export async function listProducts({
  page = 1,
  limit = 20,
  search = '',
  categoryId,
  soldBy,
  hasVariants,
  isActive,
} = {}) {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', limit);
  if (search) params.set('search', search);
  if (categoryId) params.set('categoryId', categoryId);
  if (soldBy) params.set('soldBy', soldBy);
  if (hasVariants !== undefined && hasVariants !== null && hasVariants !== '') {
    params.set('hasVariants', hasVariants);
  }
  if (isActive !== undefined && isActive !== null && isActive !== '') {
    params.set('isActive', isActive);
  }
  return apiGetWithMeta(`/products?${params.toString()}`);
}

export function getProduct(id) {
  return apiGet(`/products/${id}`);
}

export function createProduct(payload) {
  return apiPost('/products', payload);
}

export function updateProduct(id, payload) {
  return apiPut(`/products/${id}`, payload);
}

export function deleteProduct(id) {
  return apiDelete(`/products/${id}`);
}

export function getProductHistory(id) {
  return apiGet(`/products/${id}/history`);
}

export async function uploadProductImage(id, file) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await http.post(`/products/${id}/image`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export function deleteProductImage(id) {
  return apiDelete(`/products/${id}/image`);
}

export function searchProducts(q, limit = 25) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiGet(`/products/search?${params.toString()}`);
}
