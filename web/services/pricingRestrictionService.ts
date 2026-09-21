import { apiDelete, apiGet, apiPost, apiPut } from './http';

export type RestrictionType = 'MINIMUM_PRICE' | 'MAX_DISCOUNT_PERCENT' | 'MAX_DISCOUNT_AMOUNT';

export interface PricingRestrictionPayload {
  restrictionType: RestrictionType;
  minPrice?: number | null;
  maxDiscountPercent?: number | null;
  maxDiscountAmount?: number | null;
}

export function listPricingRestrictions() {
  return apiGet('/pricing-restrictions');
}

export function getPricingRestriction(productId: string) {
  return apiGet(`/pricing-restrictions/product/${productId}`);
}

export function upsertPricingRestriction(productId: string, payload: PricingRestrictionPayload) {
  return apiPut(`/pricing-restrictions/product/${productId}`, payload);
}

export function removePricingRestriction(productId: string) {
  return apiDelete(`/pricing-restrictions/product/${productId}`);
}

export function bulkApplyMaxDiscount(payload: {
  productIds: string[];
  restrictionType: 'MAX_DISCOUNT_PERCENT' | 'MAX_DISCOUNT_AMOUNT';
  maxDiscountPercent?: number | null;
  maxDiscountAmount?: number | null;
}) {
  return apiPost('/pricing-restrictions/bulk', payload);
}
