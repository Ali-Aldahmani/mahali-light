import { toast } from '@/store/toastStore';
import { printInvoice, printReceipt } from '@/services/printService';
import { downloadInvoicePdf, downloadPurchaseOrderPdf } from '@/services/pdfService';

/**
 * Printing and PDF download for invoices (and PO PDFs), with the user
 * feedback (toasts) in one place. Used by PrintButton, DownloadPDFButton
 * and the invoice row actions. Each returns whether it succeeded.
 */

export type InvoiceDocumentKind = 'invoice' | 'receipt';

export async function printInvoiceDocument({
  invoiceId,
  invoiceNumber,
  kind = 'invoice',
  silent,
  printer,
}: {
  invoiceId: string | number;
  invoiceNumber?: string;
  kind?: InvoiceDocumentKind;
  silent?: boolean;
  printer?: string;
}): Promise<boolean> {
  try {
    const fn = kind === 'receipt' ? printReceipt : printInvoice;
    const result: any = await fn(invoiceId, { silent, printer });
    if (result?.cancelled) return false;
    if (result?.success === false) {
      toast.error(`Print failed${result.error ? `: ${result.error}` : '.'}`);
      return false;
    }
    if (result?.fallback) {
      toast.info('PDF opened — use your browser to print.');
    } else {
      toast.success(
        `Sent ${invoiceNumber || 'document'} to ${kind === 'receipt' ? 'receipt' : 'invoice'} printer.`,
      );
    }
    return true;
  } catch (err: any) {
    toast.error(err?.message || 'Could not print.');
    return false;
  }
}

export async function downloadDocumentPdf({
  invoiceId,
  invoiceNumber,
  purchaseOrderId,
  purchaseOrderNumber,
}: {
  invoiceId?: string | number;
  invoiceNumber?: string;
  purchaseOrderId?: string | number;
  purchaseOrderNumber?: string;
}): Promise<boolean> {
  try {
    let result: any;
    if (purchaseOrderId) result = await downloadPurchaseOrderPdf(purchaseOrderId, purchaseOrderNumber);
    else if (invoiceId) result = await downloadInvoicePdf(invoiceId, invoiceNumber);
    else return false;
    if (result?.cancelled) return false;
    if (result?.success === false) {
      toast.error(`Download failed${result.error ? `: ${result.error}` : '.'}`);
      return false;
    }
    toast.success(result?.path ? `Saved to ${result.path}` : 'PDF downloaded.');
    return true;
  } catch (err: any) {
    toast.error(err?.message || 'Could not download PDF.');
    return false;
  }
}
