import { apiGet, apiGetWithMeta, apiPost, apiPut, apiDelete } from './http';
import { customerPaymentListSchema } from '@/lib/schemas/customerPayment';
import { validateMoneyResponse } from '@/lib/schemas/invoice';

function toParams(o: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  return p.toString();
}

export function listCustomers({
  page = 1,
  limit = 25,
  search,
  hasBalance,
  isActive,
}: {
  page?: number;
  limit?: number;
  search?: string;
  hasBalance?: boolean | string;
  isActive?: boolean | string;
} = {}) {
  return apiGetWithMeta(
    `/customers?${toParams({ page, limit, search, hasBalance, isActive })}`,
  );
}

export function getCustomer(id) {
  return apiGet(`/customers/${id}`);
}

export function createCustomer(body) {
  return apiPost('/customers', body);
}

export function updateCustomer(id, body) {
  return apiPut(`/customers/${id}`, body);
}

export function deactivateCustomer(id) {
  return apiDelete(`/customers/${id}`);
}

export function searchCustomers(q, limit = 10) {
  if (!q || !q.trim()) return Promise.resolve([]);
  return apiGet(`/customers/search?${toParams({ q, limit })}`);
}

export function getOutstandingReceivables() {
  return apiGetWithMeta(`/customers/outstanding`);
}

export function getCustomerInvoices(id) {
  return apiGet(`/customers/${id}/invoices`);
}

export async function getCustomerPayments(id) {
  const result = await apiGetWithMeta(`/customers/${id}/payments`);
  validateMoneyResponse(customerPaymentListSchema, result.data, `GET /customers/${id}/payments`);
  return result;
}

export function getCustomerReturns(id) {
  return apiGet(`/customers/${id}/returns`);
}

export function getCustomerWarranties(id) {
  return apiGet(`/customers/${id}/warranties`);
}

export function getCustomerTimeline(id) {
  return apiGet(`/customers/${id}/timeline`);
}
