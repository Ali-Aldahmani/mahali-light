import http, { apiGet, apiPost, apiDelete } from './http';
import { withRequestKey } from '@/lib/requestKey';

export function listPoPayments(poId) {
  return apiGet(`/purchase-orders/${poId}/payments`);
}

// requestKey: see lib/requestKey — makes a retried submit safe.
export function addPoPayment(poId, body, requestKey?: string) {
  return apiPost(`/purchase-orders/${poId}/payments`, body, withRequestKey(requestKey));
}

export function deletePayment(paymentId) {
  return apiDelete(`/supplier-payments/${paymentId}`);
}

export async function uploadPaymentReceipt(paymentId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await http.post(`/supplier-payments/${paymentId}/receipt`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}
