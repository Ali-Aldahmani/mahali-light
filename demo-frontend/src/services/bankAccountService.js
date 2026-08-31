import {
  apiGet,
  apiGetWithMeta,
  apiPost,
  apiPut,
  apiDelete,
} from './http.js';

function toParams(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listBankAccounts({ includeInactive = false } = {}) {
  return apiGet(
    `/bank-accounts${includeInactive ? '?include_inactive=true' : ''}`,
  );
}

export function getBankAccount(id) {
  return apiGet(`/bank-accounts/${id}`);
}

export function createBankAccount(body) {
  return apiPost('/bank-accounts', body);
}

export function updateBankAccount(id, body) {
  return apiPut(`/bank-accounts/${id}`, body);
}

export function deactivateBankAccount(id) {
  return apiDelete(`/bank-accounts/${id}`);
}

export function listBankTransactions(id, filters = {}) {
  return apiGetWithMeta(
    `/bank-accounts/${id}/transactions?${toParams(filters)}`,
  );
}

export function bankDeposit(id, body) {
  return apiPost(`/bank-accounts/${id}/deposit`, body);
}

export function bankWithdrawal(id, body) {
  return apiPost(`/bank-accounts/${id}/withdrawal`, body);
}

export function bankTransfer(id, body) {
  return apiPost(`/bank-accounts/${id}/transfer`, body);
}
