import http, { apiDelete, apiGet, apiGetWithMeta, apiPost, apiPut } from './http';

export async function listProducts({
  page = 1,
  limit = 20,
  search = '',
  categoryId,
  soldBy,
  hasVariants,
  isActive,
}: {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string | number;
  soldBy?: string;
  hasVariants?: boolean | string;
  isActive?: boolean | string;
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (search) params.set('search', search);
  if (categoryId) params.set('categoryId', String(categoryId));
  if (soldBy) params.set('soldBy', soldBy);
  if (hasVariants !== undefined && hasVariants !== null && hasVariants !== '') {
    params.set('hasVariants', String(hasVariants));
  }
  if (isActive !== undefined && isActive !== null && isActive !== '') {
    params.set('isActive', String(isActive));
  }
  return apiGetWithMeta(`/products?${params.toString()}`);
}

export function getProduct(id: string | number) {
  return apiGet(`/products/${id}`);
}

export function createProduct(payload: any) {
  return apiPost('/products', payload);
}

export function updateProduct(id: string | number, payload: any) {
  return apiPut(`/products/${id}`, payload);
}

export function deleteProduct(id: string | number) {
  return apiDelete(`/products/${id}`);
}

export function getProductHistory(id: string | number) {
  return apiGet(`/products/${id}/history`);
}

export async function uploadProductImage(id: string | number, file: File) {
  const fd = new FormData();
  fd.append('image', file);
  const res = await http.post(`/products/${id}/image`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export function deleteProductImage(id: string | number) {
  return apiDelete(`/products/${id}/image`);
}

export function searchProducts(q: string, limit = 25, opts: { categoryId?: string | number } = {}) {
  const params = new URLSearchParams({ q: q || '', limit: String(limit) });
  if (opts.categoryId) params.set('categoryId', String(opts.categoryId));
  return apiGet(`/products/search?${params.toString()}`);
}

export interface BarcodeLookupInternalMatch {
  variant_id: number;
  product_id: number;
  product_name: string;
  sku?: string;
  barcode?: string;
  internal_barcode?: string;
  supplier_barcode?: string;
}

export interface BarcodeLookupExternalMatch {
  barcode: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  provider: string;
}

export interface BarcodeLookupResult {
  barcode: string;
  source: 'internal' | 'external' | 'not_found';
  internal: BarcodeLookupInternalMatch | null;
  external: BarcodeLookupExternalMatch | null;
}

// Scan-to-autofill for "Add product". Checks this shop's own inventory first
// (to flag duplicates), then an external global barcode database.
export function lookupProductBarcode(barcode: string): Promise<BarcodeLookupResult> {
  return apiGet(`/products/barcode-lookup/${encodeURIComponent(barcode)}`);
}
