import {
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

// =======================================================================
// Reports
// =======================================================================
export function getProfitAndLoss({ startDate, endDate, compare = false } = {}) {
  return apiGet(
    `/finance/pl${qs({ start_date: startDate, end_date: endDate, compare })}`,
  );
}

export function getBalanceSheet({ asOfDate } = {}) {
  return apiGet(`/finance/balance-sheet${qs({ as_of_date: asOfDate })}`);
}

export function getCashFlow({ startDate, endDate } = {}) {
  return apiGet(`/finance/cash-flow${qs({ start_date: startDate, end_date: endDate })}`);
}

export function getVATReport({ startDate, endDate } = {}) {
  return apiGet(`/finance/vat${qs({ start_date: startDate, end_date: endDate })}`);
}

export function getFinanceDashboard() {
  return apiGet('/finance/dashboard');
}

// =======================================================================
// Journal
// =======================================================================
export function listJournal(params = {}) {
  return apiGetWithMeta(`/finance/journal${qs(params)}`);
}

export function getJournalEntry(id) {
  return apiGet(`/finance/journal/${id}`);
}

export function postManualJournalEntry(body) {
  return apiPost('/finance/journal', body);
}

// =======================================================================
// Chart of accounts
// =======================================================================
export function listAccounts() {
  return apiGet('/finance/accounts');
}

export function createAccount(body) {
  return apiPost('/finance/accounts', body);
}

export function updateAccount(id, body) {
  return apiPut(`/finance/accounts/${id}`, body);
}

export function deleteAccount(id) {
  return apiDelete(`/finance/accounts/${id}`);
}

// =======================================================================
// Periods
// =======================================================================
export function listPeriods(params = {}) {
  return apiGet(`/finance/periods${qs(params)}`);
}

export function getPeriodChecklist(id) {
  return apiGet(`/finance/periods/${id}/checklist`);
}

export function closePeriod(id, body = {}) {
  return apiPost(`/finance/periods/${id}/close`, body);
}
