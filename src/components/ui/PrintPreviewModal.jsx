import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, Download, RefreshCw } from 'lucide-react';
import Button from './Button.jsx';
import { toast } from '../../store/toastStore.js';
import {
  getInvoicePdfBlob,
  getReceiptPdfBlob,
  getPurchaseOrderPdfBlob,
  regenerateInvoicePdf,
  regeneratePurchaseOrderPdf,
  downloadInvoicePdf,
  downloadPurchaseOrderPdf,
} from '../../services/pdfService.js';
import { printInvoice, printReceipt } from '../../services/printService.js';

// A modal that shows the PDF inline with a print + download toolbar.
// One of `invoiceId` or `purchaseOrderId` must be provided. `kind="receipt"`
// previews the thermal receipt instead.
export default function PrintPreviewModal({
  open,
  onClose,
  invoiceId,
  invoiceNumber,
  purchaseOrderId,
  purchaseOrderNumber,
  kind = 'invoice',
}) {
  const [blob, setBlob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [version, setVersion] = useState(0);

  const blobUrl = useMemo(() => {
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }, [blob]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setBlob(null);
    (async () => {
      try {
        let next;
        if (purchaseOrderId) {
          next = await getPurchaseOrderPdfBlob(purchaseOrderId);
        } else if (invoiceId) {
          next =
            kind === 'receipt'
              ? await getReceiptPdfBlob(invoiceId)
              : await getInvoicePdfBlob(invoiceId);
        }
        if (!cancelled) setBlob(next || null);
      } catch (err) {
        if (!cancelled) {
          toast.error(err?.message || 'Failed to load PDF preview.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, invoiceId, purchaseOrderId, kind, version]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const title = purchaseOrderId
    ? `Preview ${purchaseOrderNumber || 'purchase order'}`
    : kind === 'receipt'
      ? `Preview receipt ${invoiceNumber || ''}`
      : `Preview invoice ${invoiceNumber || ''}`;

  const onRegenerate = async () => {
    setActing(true);
    try {
      if (purchaseOrderId) {
        await regeneratePurchaseOrderPdf(purchaseOrderId);
      } else if (invoiceId) {
        await regenerateInvoicePdf(invoiceId);
      }
      setVersion((v) => v + 1);
      toast.success('PDF regenerated.');
    } catch (err) {
      toast.error(err?.message || 'Could not regenerate PDF.');
    } finally {
      setActing(false);
    }
  };

  const onPrint = async () => {
    setActing(true);
    try {
      if (purchaseOrderId) {
        // POs have no dedicated print endpoint yet — fall back to opening the
        // PDF in a new window so the operator can print from there.
        window.open(blobUrl || '', '_blank');
      } else if (invoiceId) {
        const fn = kind === 'receipt' ? printReceipt : printInvoice;
        const result = await fn(invoiceId, { silent: false });
        if (result?.success === false && !result?.cancelled) {
          toast.error(`Print failed${result.error ? `: ${result.error}` : '.'}`);
        }
      }
    } finally {
      setActing(false);
    }
  };

  const onDownload = async () => {
    setActing(true);
    try {
      if (purchaseOrderId) {
        await downloadPurchaseOrderPdf(purchaseOrderId, purchaseOrderNumber);
      } else if (invoiceId) {
        await downloadInvoicePdf(invoiceId, invoiceNumber);
      }
    } finally {
      setActing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="relative card flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={acting}
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={onRegenerate}
            >
              Regenerate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={acting}
              leftIcon={<Download className="h-4 w-4" />}
              onClick={onDownload}
            >
              Download
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={acting}
              leftIcon={<Printer className="h-4 w-4" />}
              onClick={onPrint}
            >
              Print
            </Button>
            <button
              type="button"
              className="ml-2 rounded-input p-1 text-ink-muted hover:bg-surface-2"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-surface-2">
          {loading ? (
            <div className="flex h-full items-center justify-center text-ink-muted">
              Loading preview…
            </div>
          ) : blobUrl ? (
            <iframe
              title="PDF preview"
              src={blobUrl}
              className="h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-ink-muted">
              No PDF available.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
