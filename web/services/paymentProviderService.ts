import { apiGet, apiPost, apiPut } from './http';

export interface PaymentProvider {
  id: string;
  name: string;
  isDefault: boolean;
  bankAccountId?: string | null;
  feeMethod?: 'percent' | 'fixed' | 'percent_fixed';
  feePercent?: number;
  feeFixed?: number;
  refundFeePolicy?: 'none' | 'proportional';
  refundChargeMethod?: 'none' | 'percent' | 'fixed' | 'percent_fixed';
  refundChargePercent?: number;
  refundChargeFixed?: number;
  isActive?: boolean;
}

// Card providers. Cashiers get names only; fee managers get rates too.
export function listPaymentProviders(params: { all?: boolean } = {}) {
  return apiGet('/payment-providers', params.all ? { params: { all: 'true' } } : undefined);
}
export function createPaymentProvider(body: Partial<PaymentProvider>, requestKey: string) {
  return apiPost('/payment-providers', body, { headers: { 'Idempotency-Key': requestKey } });
}
export function updatePaymentProvider(id: string, body: Partial<PaymentProvider>) {
  return apiPut(`/payment-providers/${id}`, body);
}

// The card fee events recorded on one invoice (finance.view_pl).
export function getInvoicePaymentFees(invoiceId: string) {
  return apiGet(`/invoices/${invoiceId}/payment-fees`);
}
