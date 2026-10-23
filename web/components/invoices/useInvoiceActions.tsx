'use client';

import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Download, Eye, Printer, ReceiptText, Send, X } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PrintPreviewModal from '@/components/ui/PrintPreviewModal';
import type { RowAction } from '@/components/ui/RowActions';
import EditRequestSlideOver from '@/components/invoices/EditRequestSlideOver';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { cancelInvoice, getInvoice } from '@/services/invoiceService';
import { downloadDocumentPdf, printInvoiceDocument } from '@/lib/invoices/invoiceDocuments';

/** The invoice fields the actions need: a list row or a full invoice both fit. */
export interface InvoiceActionTarget {
  id: string;
  invoiceNumber?: string;
  status: string;
  hasReturn?: boolean;
}

/**
 * Everything you can do to an invoice, defined once: which actions apply
 * (permissions + invoice state), what they do, and the dialogs they open.
 * Used by the Invoices list (row actions) and the invoice page header, so
 * the two can never disagree.
 *
 *   const invoiceActions = useInvoiceActions({ onChanged: reload });
 *   <RowActions actions={invoiceActions.actionsFor(row, { withOpen: true })} />
 *   {invoiceActions.dialogs}
 */
export function useInvoiceActions({ onChanged }: { onChanged?: () => void } = {}) {
  const permissions: string[] = useAuthStore((s: any) => s.permissions) || [];
  const can = (p: string) => permissions.includes(p);

  const [previewing, setPreviewing] = useState<InvoiceActionTarget | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceActionTarget | null>(null);
  const [editing, setEditing] = useState<{ invoice: any; items: any[] } | null>(null);

  // The edit form needs the invoice's items, which list rows don't carry.
  async function openEditRequest(inv: InvoiceActionTarget): Promise<boolean> {
    try {
      const detail: any = await getInvoice(inv.id);
      setEditing({ invoice: detail.invoice, items: detail.items || [] });
    } catch (err: any) {
      toast.error(err?.message || 'Could not load the invoice.');
    }
    // Opens a form: nothing to confirm in place.
    return false;
  }

  function actionsFor(inv: InvoiceActionTarget, { withOpen = false, onOpen }: { withOpen?: boolean; onOpen?: () => void } = {}): RowAction[] {
    const docArgs = { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber };
    // Invoices with a return, or cancelled, can't be edited any more.
    const locked = !!inv.hasReturn || inv.status === 'cancelled';
    return [
      { id: 'open', label: 'View', icon: <ArrowUpRight />, hidden: !withOpen || !onOpen, onClick: () => onOpen?.() },
      { id: 'preview', label: 'Preview', icon: <Eye />, onClick: () => setPreviewing(inv) },
      {
        id: 'print-invoice',
        label: 'Print invoice',
        icon: <Printer />,
        doneLabel: 'Sent',
        hidden: !can('invoice.print'),
        onClick: () => printInvoiceDocument({ ...docArgs, kind: 'invoice' }),
      },
      {
        id: 'print-receipt',
        label: 'Print receipt',
        icon: <ReceiptText />,
        doneLabel: 'Sent',
        hidden: !can('invoice.print'),
        onClick: () => printInvoiceDocument({ ...docArgs, kind: 'receipt' }),
      },
      {
        id: 'download',
        label: 'Download PDF',
        icon: <Download />,
        doneLabel: 'Saved',
        hidden: !can('invoice.download'),
        onClick: () => downloadDocumentPdf(docArgs),
      },
      {
        id: 'request-edit',
        label: 'Request edit',
        icon: <Send />,
        hidden: locked || inv.status !== 'confirmed' || !can('invoice.edit_request'),
        onClick: () => openEditRequest(inv),
      },
      {
        id: 'cancel',
        label: 'Cancel invoice',
        icon: <X />,
        tone: 'danger',
        hidden: inv.status === 'cancelled' || !can('invoice.cancel'),
        onClick: () => setCancelling(inv),
      },
    ];
  }

  const dialogs: ReactNode = (
    <>
      <PrintPreviewModal
        open={!!previewing}
        onClose={() => setPreviewing(null)}
        invoiceId={previewing?.id}
        invoiceNumber={previewing?.invoiceNumber}
        kind="invoice"
      />

      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={async (extra: any) => {
          if (!cancelling) return;
          try {
            await cancelInvoice(cancelling.id, extra || null);
            toast.success('Invoice cancelled.');
            setCancelling(null);
            onChanged?.();
          } catch (err: any) {
            toast.error(err?.message || 'Could not cancel invoice.');
          }
        }}
        title={`Cancel ${cancelling?.invoiceNumber || 'this invoice'}?`}
        description="Stock will be returned and any credit charge reversed. This cannot be undone."
        confirmLabel="Cancel invoice"
        variant="danger"
      />

      <EditRequestSlideOver
        open={!!editing}
        onClose={() => setEditing(null)}
        invoice={editing?.invoice || {}}
        items={editing?.items || []}
        onSubmitted={() => {
          setEditing(null);
          onChanged?.();
        }}
      />
    </>
  );

  return { actionsFor, dialogs };
}
