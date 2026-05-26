import { apiGet, apiPost } from './http.js';
import { API_BASE } from '../config.js';
import { useAuthStore } from '../store/authStore.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// =======================================================================
// Analytics — dashboard + hub
// =======================================================================
export function getKPIs(params) {
  return apiGet(`/analytics/kpis${qs(params)}`);
}
export function getSparkline(metric = 'revenue', days = 7) {
  return apiGet(`/analytics/sparkline${qs({ metric, days })}`);
}
export function getDailySnapshot() {
  return apiGet(`/analytics/daily-snapshot`);
}
export function getSalesTimeline(params) {
  return apiGet(`/analytics/sales-timeline${qs(params)}`);
}
export function getCategoryBreakdown(params) {
  return apiGet(`/analytics/category-breakdown${qs(params)}`);
}
export function getNetProfitTrends(params) {
  return apiGet(`/analytics/net-profit-trends${qs(params)}`);
}
export function getTopProducts(params) {
  return apiGet(`/analytics/top-products${qs(params)}`);
}
export function getWorstProducts(params) {
  return apiGet(`/analytics/worst-products${qs(params)}`);
}
export function getTopSuppliers(params) {
  return apiGet(`/analytics/top-suppliers${qs(params)}`);
}
export function getWorstSuppliers(params) {
  return apiGet(`/analytics/worst-suppliers${qs(params)}`);
}
export function getTopCustomers(params) {
  return apiGet(`/analytics/top-customers${qs(params)}`);
}
export function getAtRiskCustomers(params) {
  return apiGet(`/analytics/at-risk-customers${qs(params)}`);
}
export function getEmployeePerformance(params) {
  return apiGet(`/analytics/employee-performance${qs(params)}`);
}
export function getPeakHours(params) {
  return apiGet(`/analytics/peak-hours${qs(params)}`);
}
export function getPeakDays(params) {
  return apiGet(`/analytics/peak-days${qs(params)}`);
}
export function getPeakHeatmap(params) {
  return apiGet(`/analytics/peak-heatmap${qs(params)}`);
}
export function getPeakMonths(params) {
  return apiGet(`/analytics/peak-months${qs(params)}`);
}
export function getProductSeasonality(productId, params) {
  return apiGet(`/analytics/product-seasonality/${productId}${qs(params)}`);
}

// =======================================================================
// Forecasting
// =======================================================================
export function listReorderRecommendations(params) {
  return apiGet(`/forecast/reorder${qs(params)}`);
}
export function getReorderForVariant(variantId) {
  return apiGet(`/forecast/reorder/${variantId}`);
}
export function listAnnualPlan(params) {
  return apiGet(`/forecast/annual-plan${qs(params)}`);
}
export function getAnnualPlanForVariant(variantId, params) {
  return apiGet(`/forecast/annual-plan/${variantId}${qs(params)}`);
}
export function recalculateForecasts() {
  return apiPost(`/forecast/recalculate`, {});
}
export function dismissReorderRecommendation(id) {
  return apiPost(`/forecast/reorder/${id}/dismiss`, {});
}

// Direct browser download for annual plan Excel — the endpoint streams the
// file straight to the response so we use a redirect-friendly fetch with
// the auth header rather than the apiGet helper.
export async function downloadAnnualPlanExcel(params = {}) {
  const token = useAuthStore.getState().token;
  const res = await fetch(`${API_BASE}/forecast/annual-plan/export/xlsx${qs(params)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Failed to download annual plan.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `annual-stock-plan-${params.year || new Date().getFullYear()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
