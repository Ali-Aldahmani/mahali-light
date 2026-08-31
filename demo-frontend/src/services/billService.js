import http, {
  apiGet,
  apiGetWithMeta,
  apiPost,
  apiPut,
  apiDelete,
} from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function listBills(params) {
  return apiGetWithMeta(`/bills${qs(params)}`);
}

export function getBill(id) {
  return apiGet(`/bills/${id}`);
}

export function createBill(body) {
  return apiPost('/bills', body);
}

export function updateBill(id, body) {
  return apiPut(`/bills/${id}`, body);
}

export function cancelBill(id) {
  return apiDelete(`/bills/${id}`);
}

export function pauseBill(id) {
  return apiPost(`/bills/${id}/pause`, {});
}

export function resumeBill(id) {
  return apiPost(`/bills/${id}/resume`, {});
}

export function listBillPayments(params) {
  return apiGetWithMeta(`/bill-payments${qs(params)}`);
}

export function getUpcomingBills() {
  return apiGet('/bill-payments/upcoming');
}

// Pay a bill — multipart so an optional receipt file can ride along.
export async function payBillPayment(
  billPaymentId,
  { amountPaid, paymentMethod, bankAccountId, paidDate, notes, receipt },
) {
  const fd = new FormData();
  fd.append('amountPaid', String(amountPaid));
  fd.append('paymentMethod', paymentMethod);
  if (bankAccountId) fd.append('bankAccountId', bankAccountId);
  if (paidDate) fd.append('paidDate', paidDate);
  if (notes) fd.append('notes', notes);
  if (receipt) fd.append('receipt', receipt);
  const res = await http.post(`/bill-payments/${billPaymentId}/pay`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export async function uploadBillPaymentReceipt(billPaymentId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await http.post(
    `/bill-payments/${billPaymentId}/receipt`,
    fd,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return res.data?.data;
}
