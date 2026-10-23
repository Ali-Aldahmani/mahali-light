'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Banknote,
  Check,
  History,
  Pencil,
  Receipt,
  ShieldAlert,
  UserCircle2,
  Shield,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/skeleton';
import Table, { type TableColumn } from '@/components/ui/Table';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import SlideOver from '@/components/ui/SlideOver';
import InvoiceStatusBadge from '@/components/ui/InvoiceStatusBadge';
import PaymentStatusBadge from '@/components/ui/PaymentStatusBadge';
import InvoiceTotalsBlock from '@/components/ui/InvoiceTotalsBlock';
import PaymentMethodIcon from '@/components/ui/PaymentMethodIcon';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import {
  getInvoice,
  addInvoicePayment,
} from '@/services/invoiceService';
import {
  approveEditRequest,
  rejectEditRequest,
} from '@/services/invoiceEditRequestService';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils/format';
import {
  onInvoiceEvent,
  onInvoiceEditRequestEvent,
  onWarrantyEvent,
} from '@/store/socketStore';
import { listWarranties } from '@/services/warrantyService';
import WarrantyStatusBadge from '@/components/ui/WarrantyStatusBadge';
import DaysRemainingBadge from '@/components/ui/DaysRemainingBadge';
import ActionButtons from '@/components/ui/ActionButtons';
import { useInvoiceActions } from '@/components/invoices/useInvoiceActions';
import CustomerHoverName from '@/components/customers/CustomerHoverName';

export default function InvoiceDetailPage() {
  return (
    <RequirePermission permission="invoice.view">
      <InvoiceDetailPageContent />
    </RequirePermission>
  );
}

function InvoiceDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const permissions = useAuthStore((s) => s.permissions);

  const canApproveEdit = permissions.includes('invoice.edit_approve');
  const canSeeCost = permissions.includes('product.view_cost');
  const canAddPayment = permissions.includes('invoice.create');

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [warranties, setWarranties] = useState<any[]>([]);
  // Header actions (preview, print, PDF, request edit, cancel) - shared with the Invoices list.
  const invoiceActions = useInvoiceActions({ onChanged: () => load() });

  async function loadWarranties() {
    try {
      const res = await listWarranties({ invoice_id: id, limit: 100 });
      setWarranties(res?.data || []);
    } catch (_e) {
      // Permissions or transient errors should not block the invoice page.
      setWarranties([]);
    }
  }

  async function load() {
    setLoading(true);
    try {
      setData(await getInvoice(id));
      await loadWarranties();
    } catch (err: any) {
      toast.error(err?.message || 'Invoice not found.');
      router.push('/invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const unsubA = onInvoiceEvent((evt: any) => {
      if (evt?.invoiceId === id) load();
    });
    const unsubB = onInvoiceEditRequestEvent((evt: any) => {
      if (evt?.invoiceId === id) load();
    });
    const unsubC = onWarrantyEvent((evt: any) => {
      if (evt?.invoiceId === id) loadWarranties();
    });
    return () => {
      unsubA();
      unsubB();
      unsubC();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !data) {
    return (
      <div className="py-4">
        <Skeleton lines={6} />
      </div>
    );
  }

  const inv = data.invoice;

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => router.push('/invoices')}
      >
        All invoices
      </Button>

      <PageHeader
        title={
          <span className="font-mono text-2xl text-ink">
            {inv.invoiceNumber}
          </span>
        }
        subtitle={
          <span className="text-sm text-ink-muted">
            Created by {inv.createdByUsername || 'system'}
            {' · '}
            {formatDateTime(inv.createdAt)}
            {inv.pcIdentifier && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface-2 text-ink-muted text-[10px]">
                {inv.pcIdentifier}
              </span>
            )}
          </span>
        }
        action={<ActionButtons actions={invoiceActions.actionsFor(inv)} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <InvoiceStatusBadge status={inv.status} />
        <PaymentStatusBadge status={inv.paymentStatus} />
        {inv.confirmedAt && (
          <span className="text-xs text-ink-muted">
            Confirmed by {inv.confirmedByUsername || 'system'} ·{' '}
            {formatDateTime(inv.confirmedAt)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CustomerCard invoice={inv} />
        <div className="md:col-span-2 rounded-card border border-border bg-surface p-4 shadow-card">
          <InvoiceTotalsBlock
            subtotal={inv.subtotal}
            discount={inv.discountAmount}
            invoiceDiscount={inv.invoiceDiscount}
            taxable={inv.taxableAmount}
            taxRate={inv.taxRate}
            tax={inv.taxAmount}
            total={inv.total}
            amountPaid={inv.amountPaid}
            balanceDue={inv.balanceDue}
            showPayments
            size="lg"
          />
        </div>
      </div>

      <ItemsSection items={data.items} canSeeCost={canSeeCost} />

      <PaymentsSection
        payments={data.payments}
        invoice={inv}
        canAddPayment={canAddPayment && inv.status === 'confirmed' && inv.balanceDue > 0}
        onAddPayment={() => setPayOpen(true)}
      />

      {data.editRequests?.length > 0 && (
        <EditRequestsSection
          requests={data.editRequests}
          canApprove={canApproveEdit}
          invoiceId={id}
          onChanged={load}
        />
      )}

      <InvoiceWarrantiesSection warranties={warranties} />

      <HistorySection rows={data.history} />

      {/* Slide-overs and dialogs */}
      <AddPaymentSlideOver
        open={payOpen}
        onClose={() => setPayOpen(false)}
        invoice={inv}
        onAdded={() => {
          setPayOpen(false);
          load();
        }}
      />

      {invoiceActions.dialogs}
    </div>
  );
}

// ============== Customer card ==========================================

function CustomerCard({ invoice }: { invoice: any }) {
  if (!invoice.customerId) {
    return (
      <div className="rounded-card border border-border bg-surface-2 p-4 flex items-center gap-3">
        <UserCircle2 className="h-8 w-8 text-ink-muted" />
        <div>
          <div className="text-sm font-medium text-ink">Guest sale</div>
          <div className="text-xs text-ink-muted">No customer linked</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card space-y-1">
      <div className="text-xs text-ink-muted">Customer</div>
      <div className="text-base font-semibold text-ink">
        <CustomerHoverName id={invoice.customerId} name={invoice.customerName} />
      </div>
      {invoice.customerCompany && (
        <div className="text-sm text-ink-muted">{invoice.customerCompany}</div>
      )}
      {invoice.customerPhone && (
        <div className="text-sm text-ink-muted">{invoice.customerPhone}</div>
      )}
      {invoice.customerCreditBalance != null && (
        <div className="text-xs text-ink-muted mt-2">
          Credit balance: {formatCurrency(invoice.customerCreditBalance)}
        </div>
      )}
    </div>
  );
}

// ============== Items section ==========================================

function ItemsSection({ items, canSeeCost }: { items: any[]; canSeeCost: boolean }) {
  const columns: TableColumn[] = [
    {
      key: 'product',
      header: 'Product',
      render: (r: any) => (
        <div className="min-w-0">
          <div className="text-sm text-ink truncate">{r.productName}</div>
          {Object.keys(r.variantAttributes || {}).length > 0 && (
            <div className="text-xs text-ink-muted truncate">
              {Object.entries(r.variantAttributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
            </div>
          )}
          <div className="text-[11px] text-ink-muted">{r.sku || '—'}</div>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Qty',
      align: 'right' as const,
      render: (r: any) => `${Number(r.quantity)} ${r.unitLabel || ''}`,
    },
    {
      key: 'unitPrice',
      header: 'Unit price',
      align: 'right' as const,
      render: (r: any) => formatCurrency(r.unitPrice),
    },
    {
      key: 'discount',
      header: 'Discount',
      align: 'right' as const,
      render: (r: any) =>
        Number(r.discountAmount || 0) > 0
          ? `- ${formatCurrency(r.discountAmount)}`
          : '—',
    },
    {
      key: 'lineTotal',
      header: 'Total',
      align: 'right' as const,
      render: (r: any) => (
        <span className="font-medium text-ink">
          {formatCurrency(r.lineTotal)}
        </span>
      ),
    },
    ...(canSeeCost
      ? [
          {
            key: 'cost',
            header: 'Cost',
            align: 'right' as const,
            render: (r: any) => (
              <span className="text-xs text-ink-muted">
                {formatCurrency(r.costPriceAtTime || 0)}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="rounded-card border border-border bg-surface shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-ink-muted" />
          <div className="text-sm font-semibold text-ink">Items</div>
        </div>
        <div className="text-xs text-ink-muted">{items.length} line(s)</div>
      </div>
      <Table
        columns={columns}
        rows={items}
        rowKey={(r: any) => r.id}
        empty={
          <EmptyState
            title="No items"
            description="This invoice has no items."
            icon={<Receipt className="h-6 w-6" />}
          />
        }
      />
    </div>
  );
}

// ============== Payments section =======================================

function PaymentsSection({
  payments,
  canAddPayment,
  onAddPayment,
}: {
  payments: any[];
  invoice?: any;
  canAddPayment: boolean;
  onAddPayment: () => void;
}) {
  return (
    <div className="rounded-card border border-border bg-surface shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-ink-muted" />
          <div className="text-sm font-semibold text-ink">Payments</div>
        </div>
        {canAddPayment && (
          <Button size="sm" onClick={onAddPayment}>
            Add payment
          </Button>
        )}
      </div>
      <Table
        columns={[
          {
            key: 'method',
            header: 'Method',
            render: (r: any) => (
              <PaymentMethodIcon method={r.method} />
            ),
          },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right' as const,
            render: (r: any) => (
              <span className="font-medium text-ink">
                {formatCurrency(r.amount)}
              </span>
            ),
          },
          {
            key: 'timestamp',
            header: 'Recorded',
            render: (r: any) => formatDateTime(r.timestamp),
          },
          {
            key: 'employee',
            header: 'By',
            render: (r: any) => r.employeeUsername || '—',
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (r: any) => (
              <span className="text-xs text-ink-muted">{r.notes || '—'}</span>
            ),
          },
        ]}
        rows={payments}
        rowKey={(r: any) => r.id}
        empty={
          <EmptyState
            title="No payments yet"
            description="Payments recorded against this invoice will appear here."
            icon={<Banknote className="h-6 w-6" />}
          />
        }
      />
    </div>
  );
}

// ============== Edit requests section ==================================

function EditRequestsSection({
  requests,
  canApprove,
  invoiceId,
  onChanged,
}: {
  requests: any[];
  canApprove: boolean;
  invoiceId: string;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<any>(null);
  const [rejectingId, setRejectingId] = useState<any>(null);
  const [reason, setReason] = useState('');

  async function approve(req: any) {
    setBusyId(req.id);
    try {
      await approveEditRequest(invoiceId, req.id);
      toast.success('Edit applied.');
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not approve.');
    } finally {
      setBusyId(null);
    }
  }

  async function submitReject(req: any) {
    if (!reason.trim()) {
      toast.warning('Provide a reason for rejection.');
      return;
    }
    setBusyId(req.id);
    try {
      await rejectEditRequest(invoiceId, req.id, reason.trim());
      toast.success('Edit rejected.');
      setRejectingId(null);
      setReason('');
      onChanged?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not reject.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-ink-muted" />
          <div className="text-sm font-semibold text-ink">Edit requests</div>
        </div>
        <div className="text-xs text-ink-muted">{requests.length}</div>
      </div>
      <ul className="divide-y divide-border">
        {requests.map((req) => (
          <li key={req.id} className="px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">
                  {req.requestedByUsername || 'cashier'} ·{' '}
                  <span className="text-ink-muted text-xs font-normal">
                    {formatDateTime(req.requestedAt)}
                  </span>
                </div>
                <div className="text-sm text-ink-muted mt-0.5">
                  {req.requestNote}
                </div>
                <ChangesSummary changes={req.changes} />
              </div>
              <StatusPill status={req.status} />
            </div>

            {req.status === 'pending' && canApprove && (
              <div className="flex items-center gap-2 justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRejectingId(req.id);
                    setReason('');
                  }}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  leftIcon={<Check className="h-3.5 w-3.5" />}
                  onClick={() => approve(req)}
                  loading={busyId === req.id}
                >
                  Approve
                </Button>
              </div>
            )}

            {rejectingId === req.id && (
              <div className="rounded-input border border-border bg-surface-2 p-3 space-y-2">
                <Input
                  label="Rejection reason"
                  value={reason}
                  onChange={(e: any) => setReason(e.target.value)}
                  placeholder="Explain why this edit is rejected"
                  required
                />
                <div className="flex items-center gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setRejectingId(null);
                      setReason('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => submitReject(req)}
                    loading={busyId === req.id}
                  >
                    Submit rejection
                  </Button>
                </div>
              </div>
            )}

            {req.status === 'rejected' && req.rejectionReason && (
              <div className="text-xs text-error">
                Reason: {req.rejectionReason}
              </div>
            )}
            {req.status === 'approved' && req.reviewedByUsername && (
              <div className="text-xs text-ink-muted">
                Approved by {req.reviewedByUsername} ·{' '}
                {formatDateTime(req.reviewedAt)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChangesSummary({ changes }: { changes: any }) {
  if (!changes) return null;
  const parts: string[] = [];
  if (Array.isArray(changes.items)) {
    parts.push(`${changes.items.length} item change(s)`);
  }
  if (changes.invoiceDiscount != null) {
    parts.push(`Invoice discount → ${formatCurrency(changes.invoiceDiscount)}`);
  }
  if (changes.notes != null) parts.push(`Notes`);
  if (!parts.length) return null;
  return (
    <div className="text-xs text-ink-muted mt-1">
      Changes: {parts.join(' · ')}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const META: Record<string, string> = {
    pending: 'bg-warning-light text-warning',
    approved: 'bg-success-light text-success',
    rejected: 'bg-error-light text-error',
    cancelled: 'bg-surface-2 text-ink-muted',
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-medium ${META[status] || 'bg-surface-2 text-ink-muted'}`}
    >
      {status}
    </span>
  );
}

// ============== History section ========================================

function HistorySection({ rows }: { rows: any[] }) {
  return (
    <div className="rounded-card border border-border bg-surface shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <History className="h-4 w-4 text-ink-muted" />
        <div className="text-sm font-semibold text-ink">History</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-ink-muted">
          No activity recorded.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((h) => (
            <li key={h.id} className="px-4 py-3 flex items-start gap-3">
              <div className="h-7 w-7 rounded-md bg-surface-2 inline-flex items-center justify-center shrink-0">
                <Pencil className="h-3.5 w-3.5 text-ink-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-ink">
                    {h.action}
                  </div>
                  <div className="text-xs text-ink-muted shrink-0">
                    {formatDateTime(h.timestamp)}
                  </div>
                </div>
                <div className="text-xs text-ink-muted">
                  {h.performedByUsername || 'system'}
                  {h.notes && (
                    <span className="ml-2 text-ink-muted">· {h.notes}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============== Add payment slide-over ================================

function AddPaymentSlideOver({
  open,
  onClose,
  invoice,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  invoice: any;
  onAdded: () => void;
}) {
  const paymentKey = useRef<string | null>(null);
  const balance = Number(invoice?.balanceDue || 0);
  const [amount, setAmount] = useState<any>(balance);
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(balance);
      setMethod('cash');
      setNotes('');
      setSaving(false);
    }
  }, [open, balance]);

  async function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.warning('Enter an amount greater than zero.');
      return;
    }
    setSaving(true);
    try {
      paymentKey.current ||= `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await addInvoicePayment(invoice.id, {
        idempotencyKey: paymentKey.current,
        method,
        amount: amt,
        notes: notes || null,
      });
      paymentKey.current = null;
      toast.success('Payment recorded.');
      onAdded?.();
    } catch (err: any) {
      toast.error(err?.message || 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Add payment"
      subtitle={
        invoice
          ? `Invoice ${invoice.invoiceNumber} · balance ${formatCurrency(balance)}`
          : ''
      }
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Record payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Amount"
          type="number"
          step="0.01"
          min={0}
          value={amount}
          onChange={(e: any) => setAmount(e.target.value)}
          required
        />
        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">
            Method
          </label>
          <div className="grid grid-cols-3 gap-2">
            {['cash', 'bank', 'credit'].map((m) => {
              const active = method === m;
              const disabled = m === 'credit' && !invoice.customerId;
              return (
                <button
                  type="button"
                  key={m}
                  onClick={() => !disabled && setMethod(m)}
                  disabled={disabled}
                  className={[
                    'rounded-input border px-3 py-2 text-sm transition capitalize',
                    active
                      ? 'border-accent bg-accent-light text-accent'
                      : 'border-border bg-surface text-ink hover:bg-surface-2',
                    disabled && 'opacity-40 cursor-not-allowed',
                  ].join(' ')}
                >
                  {m}
                </button>
              );
            })}
          </div>
          {!invoice.customerId && (
            <p className="text-xs text-ink-muted mt-1">
              Credit unavailable on guest sales.
            </p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium text-ink mb-1.5 block">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            placeholder="Reference number, cheque #, etc."
          />
        </div>
      </div>
    </SlideOver>
  );
}

// ============== Warranties section =====================================

function InvoiceWarrantiesSection({ warranties }: { warranties: any[] }) {
  if (!warranties || warranties.length === 0) return null;
  return (
    <div className="card p-5 mt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Shield className="h-4 w-4 text-accent" />
          Warranties ({warranties.length})
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {warranties.map((w) => (
          <Link
            key={w.id}
            href={`/warranties/${w.id}`}
            className="rounded-input border border-border bg-surface hover:border-accent p-3 flex flex-col gap-1 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-ink-muted">
                {w.warrantyNumber}
              </span>
              <WarrantyStatusBadge
                status={w.status}
                expiringSoon={w.expiringSoon}
                size="sm"
              />
            </div>
            <div className="text-sm font-medium text-ink truncate">
              {w.productName}
            </div>
            {w.serialNumber && (
              <div className="text-xs text-ink-muted font-mono">
                SN: {w.serialNumber}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-ink-muted mt-1">
              <span>
                {formatDate(w.startDate)} → {formatDate(w.endDate)}
              </span>
              {w.status === 'active' && (
                <DaysRemainingBadge daysRemaining={w.daysRemaining} size="sm" />
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
