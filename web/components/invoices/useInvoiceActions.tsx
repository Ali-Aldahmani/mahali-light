'use client';

import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Download, Eye, Printer, ReceiptText, Send, Trash2, X } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PrintPreviewModal from '@/components/ui/PrintPreviewModal';
import type { RowAction } from '@/components/ui/RowActions';
import EditRequestSlideOver from '@/components/invoices/EditRequestSlideOver';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { cancelInvoice, deleteInvoice, getInvoice } from '@/services/invoiceService';
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
export function useInvoiceActions({
  onChanged,
  onDeleted,
}: {
  onChanged?: () => void;
  /** After a delete; defaults to onChanged. The invoice page leaves itself. */
  onDeleted?: (inv: InvoiceActionTarget) => void;
} = {}) {
  const permissions: string[] = useAuthStore((s: any) => s.permissions) || [];
  const can = (p: string) => permissions.includes(p);

  const [previewing, setPreviewing] = useState<InvoiceActionTarget | null>(null);
  const [cancelling, setCancelling] = useState<InvoiceActionTarget | null>(null);
  const [deleting, setDeleting] = useState<InvoiceActionTarget | null>(null);
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
      {
        id: 'delete',
        label: 'Delete invoice',
        icon: <Trash2 />,
        tone: 'danger',
        // Admin and Manager. The server refuses a sale with a return, a
        // claimed warranty, or one that replaced another sale.
        hidden: !!inv.hasReturn || !can('invoice.delete'),
        onClick: () => setDeleting(inv),
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
        onConfirm={async (reason?: string) => {
          if (!cancelling) return;
          try {
            await cancelInvoice(cancelling.id, reason || null);
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
        reasonLabel={cancelling?.status === 'confirmed' ? 'Reason for cancelling' : undefined}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async (reason?: string) => {
          if (!deleting) return;
          try {
            await deleteInvoice(deleting.id, reason || '');
            toast.success(`Invoice ${deleting.invoiceNumber || ''} deleted.`);
            setDeleting(null);
            if (onDeleted) onDeleted(deleting);
            else onChanged?.();
          } catch (err: any) {
            toast.error(err?.message || 'Could not delete invoice.');
          }
        }}
        title={`Delete ${deleting?.invoiceNumber || 'this invoice'}?`}
        description={
          deleting?.status === 'confirmed'
            ? 'The sale is undone first: stock goes back, money is refunded from the drawer or bank, and any credit is reversed. Then the invoice is removed for good. This cannot be undone.'
            : 'The invoice is removed for good. This cannot be undone.'
        }
        confirmLabel="Delete invoice"
        variant="danger"
        reasonLabel="Reason for deleting"
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
