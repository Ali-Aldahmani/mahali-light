import { apiGet, apiPost } from './http.js';

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

// Demo build: no backend exists to render a real Excel file, so we simulate
// the download by generating a CSV of the annual plan data client-side.
export async function downloadAnnualPlanExcel(params = {}) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const plan = await getAnnualPlanForVariant(params.variantId || 'default', params);
  const list = Array.isArray(plan) ? plan : plan?.data || [];
  const headers = list.length > 0 ? Object.keys(list[0]) : ['month', 'projected_units'];
  const text = [
    headers.join(','),
    ...list.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')),
  ].join('\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `annual-stock-plan-${params.year || new Date().getFullYear()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
