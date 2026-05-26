import { apiPost, apiDelete } from './http.js';

export function collectPayment(customerId, body) {
  return apiPost(`/customers/${customerId}/payments`, body);
}

export function voidPayment(paymentId) {
  return apiDelete(`/customer-payments/${paymentId}`);
}
