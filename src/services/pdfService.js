import http, { apiPost, apiGet } from './http.js';
import { getApiBase } from '../config.js';
import { useAuthStore } from '../store/authStore.js';

// Build an absolute URL to a PDF endpoint. The Authorization header travels
// via the axios interceptor for fetches via `http`, but for raw downloads we
// emit a URL the Electron IPC bridge can pull directly.
function pdfUrl(invoiceId, kind = 'pdf') {
  return `${getApiBase()}/invoices/${invoiceId}/${kind}`;
}

function poPdfUrl(poId) {
  return `${getApiBase()}/purchase-orders/${poId}/pdf`;
}

export function getInvoicePdfMeta(invoiceId) {
  return apiGet(`/invoices/${invoiceId}/pdf/meta`);
}

export function regenerateInvoicePdf(invoiceId) {
  return apiPost(`/invoices/${invoiceId}/pdf/regenerate`, {});
}

export function regeneratePurchaseOrderPdf(poId) {
  return apiPost(`/purchase-orders/${poId}/pdf/regenerate`, {});
}

// Fetch a PDF as a Blob (used for in-browser preview if no Electron host).
async function fetchPdfBlob(url) {
  const res = await http.get(url.replace(getApiBase(), ''), {
    responseType: 'blob',
  });
  return res.data;
}

export async function getInvoicePdfBlob(invoiceId) {
  return fetchPdfBlob(pdfUrl(invoiceId, 'pdf'));
}

export async function getReceiptPdfBlob(invoiceId) {
  return fetchPdfBlob(pdfUrl(invoiceId, 'receipt'));
}

export async function getPurchaseOrderPdfBlob(poId) {
  return fetchPdfBlob(poPdfUrl(poId).replace(getApiBase(), ''));
}

// Trigger a save dialog (Electron) or fall back to a regular download.
export async function downloadInvoicePdf(invoiceId, invoiceNumber) {
  const filename = `${(invoiceNumber || 'invoice').replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;
  const url = pdfUrl(invoiceId, 'pdf');
  if (window.electron?.downloadPdf) {
    const token = useAuthStore.getState().token;
    return window.electron.downloadPdf({ url, token, filename });
  }
  return browserDownload(url, filename);
}

export async function downloadPurchaseOrderPdf(poId, poNumber) {
  const filename = `${(poNumber || 'purchase-order').replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;
  const url = poPdfUrl(poId);
  if (window.electron?.downloadPdf) {
    const token = useAuthStore.getState().token;
    return window.electron.downloadPdf({ url, token, filename });
  }
  return browserDownload(url, filename);
}

async function browserDownload(url, filename) {
  const blob = await fetchPdfBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  return { success: true };
}

export function buildInvoicePdfUrl(invoiceId, kind = 'pdf') {
  return pdfUrl(invoiceId, kind);
}

export function buildPurchaseOrderPdfUrl(poId) {
  return poPdfUrl(poId);
}
