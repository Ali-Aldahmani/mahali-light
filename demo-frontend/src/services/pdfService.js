import { toast } from '../store/toastStore.js';

export function getInvoicePdfMeta(invoiceId) {
  return Promise.resolve({
    generated_at: new Date().toISOString(),
    filesize_bytes: 42180,
    page_count: 1,
  });
}

export function regenerateInvoicePdf(invoiceId) {
  toast.success('Invoice PDF refreshed');
  return Promise.resolve({ success: true });
}

export function regeneratePurchaseOrderPdf(poId) {
  toast.success('PO PDF refreshed');
  return Promise.resolve({ success: true });
}

export async function downloadInvoicePdf(invoiceId, invoiceNumber) {
  toast.success(`Downloaded ${invoiceNumber || 'Invoice'}.pdf (Demo simulation)`);
  return { success: true };
}

export async function downloadPurchaseOrderPdf(poId, poNumber) {
  toast.success(`Downloaded ${poNumber || 'PO'}.pdf (Demo simulation)`);
  return { success: true };
}

export function buildInvoicePdfUrl(invoiceId, kind = 'pdf') {
  return '#';
}

export function buildPurchaseOrderPdfUrl(poId) {
  return '#';
}

export async function getInvoicePdfBlob(invoiceId) {
  return new Blob(['Mock PDF Content'], { type: 'application/pdf' });
}

export async function getReceiptPdfBlob(invoiceId) {
  return new Blob(['Mock Receipt Content'], { type: 'application/pdf' });
}

export async function getPurchaseOrderPdfBlob(poId) {
  return new Blob(['Mock PO Content'], { type: 'application/pdf' });
}
