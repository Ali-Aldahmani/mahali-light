import {
  apiGet,
  apiGetWithMeta,
  apiPost,
  apiPut,
} from './http.js';

function toParams(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, v);
  }
  return p.toString();
}

export function listInvoices(filters = {}) {
  return apiGetWithMeta(`/invoices?${toParams(filters)}`);
}

export function getInvoice(id) {
  return apiGet(`/invoices/${id}`);
}

export function createInvoice(body) {
  return apiPost('/invoices', body);
}

export function updateInvoiceItems(id, body) {
  return apiPut(`/invoices/${id}/items`, body);
}

export function confirmInvoice(id) {
  return apiPost(`/invoices/${id}/confirm`, {});
}

export function cancelInvoice(id, reason) {
  return apiPost(`/invoices/${id}/cancel`, { reason });
}

export function addInvoicePayment(id, body) {
  return apiPost(`/invoices/${id}/payments`, body);
}

export function getInvoicePayments(id) {
  return apiGet(`/invoices/${id}/payments`);
}

export function nextInvoiceNumber(pcIdentifier) {
  return apiGet(`/invoices/next-number?${toParams({ pcIdentifier })}`);
}
