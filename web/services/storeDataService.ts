import { apiGet, apiPost, apiPut } from './http';

// Lost sales, promotions, store calendar and opening hours (server: routes/storeData.js).
// Kept for later demand forecasting: what isn't recorded now can't be rebuilt.

export const recordLostSale = (body: { variantId: string; quantity?: number; source?: 'till_out_of_stock' | 'manual'; note?: string | null }) =>
  apiPost('/store-data/lost-sales', body);
export const listLostSales = (params: { start_date?: string; end_date?: string } = {}) =>
  apiGet('/store-data/lost-sales', { params });

export const listPromotions = () => apiGet('/store-data/promotions');
export const createPromotion = (body: any) => apiPost('/store-data/promotions', body);
export const endPromotion = (id: string) => apiPost(`/store-data/promotions/${id}/end`, {});

export const listCalendar = (params: { start_date?: string; end_date?: string } = {}) =>
  apiGet('/store-data/store-calendar', { params });
export const createCalendarEvent = (body: any) => apiPost('/store-data/store-calendar', body);
export const updateCalendarEvent = (id: string, body: any) => apiPut(`/store-data/store-calendar/${id}`, body);

export const getStoreHours = () => apiGet('/store-data/store-hours');
export const setStoreHours = (body: { effectiveFrom?: string; hours: Record<string, { open: string; close: string } | null> }) =>
  apiPost('/store-data/store-hours', body);
