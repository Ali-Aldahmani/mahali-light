import http, { apiGet, apiPost, apiDelete } from './http.js';

export function listPoPayments(poId) {
  return apiGet(`/purchase-orders/${poId}/payments`);
}

export function addPoPayment(poId, body) {
  return apiPost(`/purchase-orders/${poId}/payments`, body);
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
