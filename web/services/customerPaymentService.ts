import { apiPost, apiDelete } from './http';
import {
  collectPaymentResponseSchema,
  voidPaymentResponseSchema,
} from '@/lib/schemas/customerPayment';
import { validateMoneyResponse } from '@/lib/schemas/invoice';

export async function collectPayment(customerId, body) {
  const data = await apiPost(`/customers/${customerId}/payments`, body);
  validateMoneyResponse(collectPaymentResponseSchema, data, `POST /customers/${customerId}/payments`);
  return data;
}

export async function voidPayment(paymentId) {
  const data = await apiDelete(`/customer-payments/${paymentId}`);
  validateMoneyResponse(voidPaymentResponseSchema, data, `DELETE /customer-payments/${paymentId}`);
  return data;
}
