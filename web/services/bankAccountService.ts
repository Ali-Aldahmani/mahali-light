import {
  apiGet,
  apiGetWithMeta,
  apiPost,
  apiPut,
  apiDelete,
} from './http';
import { withRequestKey } from '@/lib/requestKey';

function toParams(obj: Record<string, any>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
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

// requestKey: see lib/requestKey — makes a retried submit safe.
export function bankDeposit(id, body, requestKey?: string) {
  return apiPost(`/bank-accounts/${id}/deposit`, body, withRequestKey(requestKey));
}

export function bankWithdrawal(id, body, requestKey?: string) {
  return apiPost(`/bank-accounts/${id}/withdrawal`, body, withRequestKey(requestKey));
}

export function bankTransfer(id, body, requestKey?: string) {
  return apiPost(`/bank-accounts/${id}/transfer`, body, withRequestKey(requestKey));
}
