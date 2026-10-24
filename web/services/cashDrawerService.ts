import {
  apiGet,
  apiGetWithMeta,
  apiPost,
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

export function getDrawerState() {
  return apiGet('/cash-drawer');
}

export function openDrawer(openingBalance, notes = null) {
  return apiPost('/cash-drawer/open', { openingBalance, notes });
}

export function closeDrawer({ closingBalance, notes = null, force = false }) {
  return apiPost('/cash-drawer/close', { closingBalance, notes, force });
}

// requestKey: see lib/requestKey — makes a retried submit safe.
export function adjustDrawer({ amount, direction, reason }, requestKey?: string) {
  return apiPost('/cash-drawer/adjust', { amount, direction, reason }, withRequestKey(requestKey));
}

export function transferCashToBank({ toId, amount, transferDate, notes }, requestKey?: string) {
  return apiPost('/cash-drawer/transfer', {
    toType: 'bank_account',
    toId,
    amount,
    transferDate,
    notes,
  }, withRequestKey(requestKey));
}

export function listCashTransactions(filters = {}) {
  return apiGetWithMeta(`/cash-drawer/transactions?${toParams(filters)}`);
}

export function listCashSessions(filters = {}) {
  return apiGetWithMeta(`/cash-drawer/sessions?${toParams(filters)}`);
}

export function getCashSession(id) {
  return apiGet(`/cash-drawer/sessions/${id}`);
}

export function listCashTransfers(filters = {}) {
  return apiGetWithMeta(`/cash-drawer/transfers?${toParams(filters)}`);
}
