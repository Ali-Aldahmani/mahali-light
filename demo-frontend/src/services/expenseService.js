import http, {
  apiGet,
  apiGetWithMeta,
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

export function listExpenses(params) {
  return apiGetWithMeta(`/expenses${qs(params)}`);
}

export function getExpense(id) {
  return apiGet(`/expenses/${id}`);
}

export function getExpenseSummary({ month, year } = {}) {
  return apiGet(`/expenses/summary${qs({ month, year })}`);
}

export function deleteExpense(id) {
  return apiDelete(`/expenses/${id}`);
}

// Create an expense — multipart so the optional receipt rides along.
export async function createExpense({
  categoryId,
  description,
  amount,
  expenseDate,
  paymentMethod,
  bankAccountId,
  notes,
  receipt,
}) {
  const fd = new FormData();
  if (categoryId) fd.append('categoryId', categoryId);
  fd.append('description', description);
  fd.append('amount', String(amount));
  if (expenseDate) fd.append('expenseDate', expenseDate);
  fd.append('paymentMethod', paymentMethod);
  if (bankAccountId) fd.append('bankAccountId', bankAccountId);
  if (notes) fd.append('notes', notes);
  if (receipt) fd.append('receipt', receipt);
  const res = await http.post('/expenses', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export async function uploadExpenseReceipt(expenseId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await http.post(`/expenses/${expenseId}/receipt`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}
