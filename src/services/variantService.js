import http, { apiDelete, apiGet, apiPost, apiPut } from './http.js';

export function listVariants(productId) {
  return apiGet(`/products/${productId}/variants`);
}

export function createVariant(productId, payload) {
  return apiPost(`/products/${productId}/variants`, payload);
}

export function updateVariant(productId, variantId, payload) {
  return apiPut(`/products/${productId}/variants/${variantId}`, payload);
}

export function deleteVariant(productId, variantId) {
  return apiDelete(`/products/${productId}/variants/${variantId}`);
}

export async function uploadVariantImage(productId, variantId, file) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await http.post(`/products/${productId}/variants/${variantId}/image`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export function findByBarcode(barcode) {
  return apiGet(`/variants/barcode/${encodeURIComponent(barcode)}`);
}

export function findBySku(sku) {
  return apiGet(`/variants/sku/${encodeURIComponent(sku)}`);
}

export function generateInternalBarcode(categoryId) {
  return apiPost('/variants/generate-barcode', { categoryId });
}
