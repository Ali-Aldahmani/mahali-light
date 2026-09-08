import { apiGet, apiGetWithMeta } from './http';

function toParams(o: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function getStockSummary({
  page = 1,
  limit = 25,
  search,
  categoryId,
  status = 'all',
  includeTotals = 1,
}: {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string | number;
  status?: string;
  includeTotals?: number;
} = {}) {
  return apiGetWithMeta(
    `/stock/summary?${toParams({
      page,
      limit,
      search,
      categoryId,
      status,
      includeTotals,
    })}`,
  );
}

export function listMovements({
  page = 1,
  limit = 25,
  search,
  productId,
  variantId,
  movementType,
  employeeId,
  referenceType,
  dateFrom,
  dateTo,
}: {
  page?: number;
  limit?: number;
  search?: string;
  productId?: string | number;
  variantId?: string | number;
  movementType?: string;
  employeeId?: string | number;
  referenceType?: string;
  dateFrom?: string;
  dateTo?: string;
} = {}) {
  return apiGetWithMeta(
    `/stock/movements?${toParams({
      page,
      limit,
      search,
      productId,
      variantId,
      movementType,
      employeeId,
      referenceType,
      dateFrom,
      dateTo,
    })}`,
  );
}

export function listProductMovements(productId, opts = {}) {
  const qs = toParams(opts);
  return apiGet(`/stock/movements/product/${productId}${qs ? `?${qs}` : ''}`);
}

export function listVariantMovements(variantId, opts = {}) {
  const qs = toParams(opts);
  return apiGet(`/stock/movements/variant/${variantId}${qs ? `?${qs}` : ''}`);
}

export function getLowStock() {
  return apiGet('/stock/low-stock');
}

export function getDeadStock(days = 30) {
  return apiGetWithMeta(`/stock/dead-stock?${toParams({ days })}`);
}

export function getStockValuation() {
  return apiGetWithMeta('/stock/valuation');
}
