'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  PackageCheck,
  Plus,
  RefreshCcw,
  Upload,
  XCircle,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import POStatusBadge from '@/components/ui/POStatusBadge';
import PaymentStatusBadge from '@/components/ui/PaymentStatusBadge';
import DownloadPDFButton from '@/components/ui/DownloadPDFButton';
import PrintPreviewModal from '@/components/ui/PrintPreviewModal';
import POItemsTable from '@/components/ui/POItemsTable';
import PaymentHistoryTable from '@/components/ui/PaymentHistoryTable';
import AttachmentCard from '@/components/ui/AttachmentCard';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import {
  getPurchaseOrder,
  confirmPurchaseOrder,
  deletePurchaseOrder,
  uploadPurchaseOrderAttachment,
  deletePurchaseOrderAttachment,
} from '@/services/purchaseOrderService';
import {
  listPoPayments,
  deletePayment,
} from '@/services/supplierPaymentService';
import ReceiveItemsSlideOver from '@/components/purchases/ReceiveItemsSlideOver';
import AddPaymentSlideOver from '@/components/purchases/AddPaymentSlideOver';
import SupplierReturnSlideOver from '@/components/purchases/SupplierReturnSlideOver';
import { onPurchaseOrderEvent } from '@/store/socketStore';
import type { Payment, PurchaseOrder } from '@/components/purchases/types';

function PurchaseOrderDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const permissions = useAuthStore((s: any) => s.permissions);
  const canCreatePo = permissions.includes('supplier.purchase_order.create');
  const canPay = permissions.includes('supplier.purchase_order.pay');
  const canSeeCost = permissions.includes('product.view_cost');

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<Payment | null>(
    null,
  );

  async function load() {
    setLoading(true);
    try {
      const [poData, pmData] = await Promise.all([
        getPurchaseOrder(id),
        listPoPayments(id),
      ]);
      setPo(poData);
      setPayments(pmData || []);
    } catch (err: any) {
      toast.error(err?.message || 'Purchase order not found.');
      router.push('/purchase-orders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    return onPurchaseOrderEvent((evt: any) => {
      if (evt?.poId === id) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !po) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  const isDraft = po.status === 'draft';
  const canReceive =
    canCreatePo && ['confirmed', 'partially_received'].includes(po.status);
  const canAddPayment =
    canPay && Number(po.balanceDue || 0) > 0 && po.status !== 'cancelled';

  async function handleConfirm() {
    setConfirming(true);
    try {
      const updated = await confirmPurchaseOrder(id);
      setPo((p) => (p ? { ...p, ...updated } : p));
      toast.success('Purchase order confirmed.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to confirm PO.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleCancel() {
    try {
      await deletePurchaseOrder(id);
      toast.success('Draft cancelled.');
      router.push('/purchase-orders');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to cancel PO.');
      setConfirmCancel(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const saved = await uploadPurchaseOrderAttachment(id, file);
      setPo((p) => (p ? { ...p, attachmentPath: saved.attachmentPath } : p));
      toast.success('Invoice uploaded.');
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveAttachment() {
    try {
      await deletePurchaseOrderAttachment(id);
      setPo((p) => (p ? { ...p, attachmentPath: null } : p));
      toast.success('Attachment removed.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove attachment.');
    }
  }

  async function handleDeletePayment() {
    if (!confirmDeletePayment) return;
    try {
      const res = await deletePayment(confirmDeletePayment.id);
      setPo((p) =>
        p
          ? {
              ...p,
              amountPaid: res.purchaseOrder.amountPaid,
              balanceDue: res.purchaseOrder.balanceDue,
              paymentStatus: res.purchaseOrder.paymentStatus,
            }
          : p,
      );
      setPayments((list) => list.filter((pm) => pm.id !== confirmDeletePayment.id));
      toast.success('Payment reversed.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reverse payment.');
    } finally {
      setConfirmDeletePayment(null);
    }
  }

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => router.push('/purchase-orders')}
      >
        All purchase orders
      </Button>

      <PageHeader
        title={po.poNumber}
        subtitle={
          <span>
            From{' '}
            <button
              type="button"
              onClick={() => router.push(`/suppliers/${po.supplierId}`)}
              className="text-accent hover:underline"
            >
              {po.supplierName}
            </button>
            {' · '}
            ordered {formatDate(po.orderDate)}
          </span>
        }
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <POStatusBadge status={po.status} />
            <PaymentStatusBadge status={po.paymentStatus} />
            <Button
              variant="ghost"
              leftIcon={<Eye className="h-4 w-4" />}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
            <DownloadPDFButton
              purchaseOrderId={po.id}
              purchaseOrderNumber={po.poNumber}
              variant="ghost"
              permission="supplier.view"
              label="PDF"
            />
            {isDraft && canCreatePo && (
              <Button
                variant="secondary"
                leftIcon={<CheckCircle2 className="h-4 w-4" />}
                onClick={handleConfirm}
                loading={confirming}
              >
                Confirm
              </Button>
            )}
            {canReceive && (
              <Button
                leftIcon={<PackageCheck className="h-4 w-4" />}
                onClick={() => setReceiveOpen(true)}
              >
                Receive items
              </Button>
            )}
            {canAddPayment && (
              <Button
                variant="secondary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => setPaymentOpen(true)}
              >
                Add payment
              </Button>
            )}
            {po.items?.some((it) => Number(it.quantityReceived) > 0) && canCreatePo && (
              <Button
                variant="ghost"
                leftIcon={<RefreshCcw className="h-4 w-4" />}
                onClick={() => setReturnOpen(true)}
              >
                Return to supplier
              </Button>
            )}
            {isDraft && canCreatePo && (
              <Button
                variant="danger"
                leftIcon={<XCircle className="h-4 w-4" />}
                onClick={() => setConfirmCancel(true)}
              >
                Cancel PO
              </Button>
            )}
          </div>
        }
      />

      {canSeeCost && (
        <div className="grid grid-cols-5 gap-3">
          <Stat label="Subtotal" value={formatCurrency(po.subtotal)} />
          <Stat label="Tax / shipping" value={formatCurrency(po.taxAmount)} />
          <Stat label="Total" value={formatCurrency(po.totalCost)} tone="ink" />
          <Stat label="Paid" value={formatCurrency(po.amountPaid)} />
          <Stat
            label="Balance"
            value={formatCurrency(po.balanceDue)}
            tone={(po.balanceDue || 0) > 0 ? 'warning' : 'success'}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Items</h2>
            {po.expectedDate && (
              <div className="text-xs text-ink-muted">
                Expected: {formatDate(po.expectedDate)}
                {po.receivedDate && ` · Received: ${formatDate(po.receivedDate)}`}
              </div>
            )}
          </div>
          <POItemsTable items={po.items || []} editable={false} showCost={canSeeCost} />
          {po.notes && (
            <div className="rounded-input bg-surface-2 px-3 py-2 text-sm text-ink-muted">
              {po.notes}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Invoice attachment</h2>
              {canCreatePo && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Upload className="h-4 w-4" />}
                    onClick={() => fileInputRef.current?.click()}
                    loading={uploading}
                  >
                    {po.attachmentPath ? 'Replace' : 'Upload'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/*"
                    className="hidden"
                    onChange={handleUpload}
                  />
                </>
              )}
            </div>
            {po.attachmentPath ? (
              <AttachmentCard
                path={po.attachmentPath}
                filename={`Invoice · ${po.poNumber}`}
                uploadedAt={po.updatedAt}
                onDelete={canCreatePo ? handleRemoveAttachment : undefined}
              />
            ) : (
              <div className="rounded-card border border-dashed border-border bg-surface-2 p-6 text-center text-xs text-ink-muted">
                No invoice attached yet.
              </div>
            )}
          </div>

          {canSeeCost && (
            <div className="card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Payment history</h2>
                <div className="text-xs text-ink-muted">
                  Balance:{' '}
                  <span
                    className={
                      (po.balanceDue || 0) > 0
                        ? 'text-accent font-medium'
                        : 'text-success font-medium'
                    }
                  >
                    {formatCurrency(po.balanceDue)}
                  </span>
                </div>
              </div>
              <PaymentHistoryTable
                payments={payments}
                showPo={false}
                onDelete={canPay ? (p: Payment) => setConfirmDeletePayment(p) : undefined}
              />
            </div>
          )}
        </div>
      </div>

      <ReceiveItemsSlideOver
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        po={po}
        onReceived={() => load()}
      />
      <AddPaymentSlideOver
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        po={po}
        onAdded={() => load()}
      />
      <SupplierReturnSlideOver
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        po={po}
        onCreated={() => load()}
      />

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={handleCancel}
        title="Cancel this draft PO?"
        description="The draft will be permanently deleted. Items, totals, and the attachment will be removed."
        confirmLabel="Cancel PO"
        variant="danger"
      />
      <ConfirmDialog
        open={!!confirmDeletePayment}
        onClose={() => setConfirmDeletePayment(null)}
        onConfirm={handleDeletePayment}
        title={`Reverse payment of ${
          confirmDeletePayment ? formatCurrency(confirmDeletePayment.amount) : ''
        }?`}
        description="Only same-day payments can be reversed. The PO totals will be updated."
        confirmLabel="Reverse"
        variant="danger"
      />

      <PrintPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        purchaseOrderId={po.id}
        purchaseOrderNumber={po.poNumber}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'ink' | 'warning' | 'success';
}) {
  const TONES: Record<string, string> = {
    default: 'text-ink',
    ink: 'text-ink font-semibold',
    warning: 'text-accent font-medium',
    success: 'text-success font-medium',
  };
  return (
    <div className="rounded-card border border-border bg-surface p-3 shadow-card">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-base mt-1 ${TONES[tone]}`}>{value}</div>
    </div>
  );
}

export default function PurchaseOrderDetailPage() {
  return (
    <RequirePermission permission="supplier.view">
      <PurchaseOrderDetailPageContent />
    </RequirePermission>
  );
}
