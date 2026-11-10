import { apiGet } from './http';

// Product lifecycle (server/services/productLifecycleService.js). Cost,
// revenue and supplier fields are left out by the server for users who may
// not see them, so every money field here is optional.

export interface LifecycleRange {
  start_date?: string;
  end_date?: string;
}

const clean = (p: Record<string, any>) => Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== ''));

export function getProductLifecycle(productId: string, range: LifecycleRange = {}) {
  return apiGet(`/products/${productId}/lifecycle`, { params: clean(range) });
}
export function getLifecycleReceipts(productId: string, params: { page?: number; limit?: number } = {}) {
  return apiGet(`/products/${productId}/lifecycle/receipts`, { params: clean(params) });
}
export function getLifecycleSales(productId: string, params: LifecycleRange & { page?: number; limit?: number } = {}) {
  return apiGet(`/products/${productId}/lifecycle/sales`, { params: clean(params) });
}
export function getLifecycleTimeline(
  productId: string,
  params: LifecycleRange & { page?: number; limit?: number; types?: string } = {},
) {
  return apiGet(`/products/${productId}/lifecycle/timeline`, { params: clean(params) });
}
