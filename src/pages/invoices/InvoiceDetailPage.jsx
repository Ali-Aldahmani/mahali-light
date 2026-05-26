import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Banknote,
  Check,
  Eye,
  History,
  Pencil,
  Receipt,
  Send,
  ShieldAlert,
  UserCircle2,
  X,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import Table from '../../components/ui/Table.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Input from '../../components/ui/Input.jsx';
import SlideOver from '../../components/ui/SlideOver.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import InvoiceStatusBadge from '../../components/ui/InvoiceStatusBadge.jsx';
import PaymentStatusBadge from '../../components/ui/PaymentStatusBadge.jsx';
import InvoiceTotalsBlock from '../../components/ui/InvoiceTotalsBlock.jsx';
import PaymentMethodIcon from '../../components/ui/PaymentMethodIcon.jsx';
import PrintButton from '../../components/ui/PrintButton.jsx';
import DownloadPDFButton from '../../components/ui/DownloadPDFButton.jsx';
import PrintPreviewModal from '../../components/ui/PrintPreviewModal.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import {
  getInvoice,
  cancelInvoice as cancelInvoiceApi,
  addInvoicePayment,
} from '../../services/invoiceService.js';
import {
  createEditRequest,
  approveEditRequest,
  rejectEditRequest,
} from '../../services/invoiceEditRequestService.js';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from '../../utils/format.js';
import {
  onInvoiceEvent,
  onInvoiceEditRequestEvent,
} from '../../store/socketStore.js';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);

  const canEditRequest = permissions.includes('invoice.edit_request');
  const canApproveEdit = permissions.includes('invoice.edit_approve');
  const canCancel = permissions.includes('invoice.cancel');
  const canSeeCost = permissions.includes('product.view_cost');
  const canAddPayment = permissions.includes('invoice.create');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await getInvoice(id));
    } catch (err) {
      toast.error(err?.message || 'Invoice not found.');
      navigate('/invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const unsubA = onInvoiceEvent((evt) => {
      if (evt?.invoiceId === id) load();
    });
    const unsubB = onInvoiceEditRequestEvent((evt) => {
      if (evt?.invoiceId === id) load();
    });
    return () => {
      unsubA();
      unsubB();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  const inv = data.invoice;
  const isLocked = inv.hasReturn || inv.status === 'cancelled';

  return (
    <div className="space-y-5">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft className="h-4 w-4" />}
        onClick={() => navigate('/invoices')}
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
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              leftIcon={<Eye className="h-4 w-4" />}
              onClick={() => setPreviewOpen(true)}
            >
              Preview
            </Button>
            <PrintButton
              invoiceId={inv.id}
              invoiceNumber={inv.invoiceNumber}
              kind="invoice"
              variant="secondary"
            />
            <PrintButton
              invoiceId={inv.id}
              invoiceNumber={inv.invoiceNumber}
              kind="receipt"
              variant="secondary"
              label="Print receipt"
            />
            <DownloadPDFButton
              invoiceId={inv.id}
              invoiceNumber={inv.invoiceNumber}
              variant="secondary"
            />
            {!isLocked && canEditRequest && inv.status === 'confirmed' && (
              <Button
                variant="secondary"
                leftIcon={<Send className="h-4 w-4" />}
                onClick={() => setEditOpen(true)}
              >
                Request edit
              </Button>
            )}
            {canCancel && inv.status !== 'cancelled' && (
              <Button
                variant="secondary"
                leftIcon={<X className="h-4 w-4" />}
                onClick={() => setCancelOpen(true)}
              >
                Cancel invoice
              </Button>
            )}
          </div>
        }
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

      <HistorySection rows={data.history} />

      {/* Slide-overs and dialogs */}
      <EditRequestSlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        invoice={inv}
        items={data.items}
        onSubmitted={() => {
          setEditOpen(false);
          load();
        }}
      />

      <AddPaymentSlideOver
        open={payOpen}
        onClose={() => setPayOpen(false)}
        invoice={inv}
        onAdded={() => {
          setPayOpen(false);
          load();
        }}
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={async (extra) => {
          try {
            await cancelInvoiceApi(id, extra || null);
            toast.success('Invoice cancelled.');
            setCancelOpen(false);
            load();
          } catch (err) {
            toast.error(err?.message || 'Could not cancel invoice.');
          }
        }}
        title="Cancel this invoice?"
        description="Stock will be returned and any credit charge reversed. This cannot be undone."
        confirmLabel="Cancel invoice"
        variant="danger"
      />

      <PrintPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        invoiceId={inv.id}
        invoiceNumber={inv.invoiceNumber}
        kind="invoice"
      />
    </div>
  );
}

// ============== Customer card ==========================================

function CustomerCard({ invoice }) {
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
      <div className="text-base font-semibold text-ink">{invoice.customerName}</div>
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

function ItemsSection({ items, canSeeCost }) {
  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (r) => (
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
      align: 'right',
      render: (r) => `${Number(r.quantity)} ${r.unitLabel || ''}`,
    },
    {
      key: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      render: (r) => formatCurrency(r.unitPrice),
    },
    {
      key: 'discount',
      header: 'Discount',
      align: 'right',
      render: (r) =>
        Number(r.discountAmount || 0) > 0
          ? `- ${formatCurrency(r.discountAmount)}`
          : '—',
    },
    {
      key: 'lineTotal',
      header: 'Total',
      align: 'right',
      render: (r) => (
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
            align: 'right',
            render: (r) => (
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
        rowKey={(r) => r.id}
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

function PaymentsSection({ payments, canAddPayment, onAddPayment }) {
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
            render: (r) => (
              <PaymentMethodIcon method={r.method} />
            ),
          },
          {
            key: 'amount',
            header: 'Amount',
            align: 'right',
            render: (r) => (
              <span className="font-medium text-ink">
                {formatCurrency(r.amount)}
              </span>
            ),
          },
          {
            key: 'timestamp',
            header: 'Recorded',
            render: (r) => formatDateTime(r.timestamp),
          },
          {
            key: 'employee',
            header: 'By',
            render: (r) => r.employeeUsername || '—',
          },
          {
            key: 'notes',
            header: 'Notes',
            render: (r) => (
              <span className="text-xs text-ink-muted">{r.notes || '—'}</span>
            ),
          },
        ]}
        rows={payments}
        rowKey={(r) => r.id}
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

function EditRequestsSection({ requests, canApprove, invoiceId, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');

  async function approve(req) {
    setBusyId(req.id);
    try {
      await approveEditRequest(invoiceId, req.id);
      toast.success('Edit applied.');
      onChanged?.();
    } catch (err) {
      toast.error(err?.message || 'Could not approve.');
    } finally {
      setBusyId(null);
    }
  }

  async function submitReject(req) {
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
    } catch (err) {
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
                  onChange={(e) => setReason(e.target.value)}
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

function ChangesSummary({ changes }) {
  if (!changes) return null;
  const parts = [];
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

function StatusPill({ status }) {
  const META = {
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

function HistorySection({ rows }) {
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

// ============== Edit request slide-over ================================

function EditRequestSlideOver({ open, onClose, invoice, items, onSubmitted }) {
  const [note, setNote] = useState('');
  const [draftItems, setDraftItems] = useState([]);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setDraftItems(
        items.map((it) => ({
          variant_id: it.variantId,
          productName: it.productName,
          unit_label: it.unitLabel,
          quantity: Number(it.quantity),
          unit_price: Number(it.unitPrice),
          discount_amount: Number(it.discountAmount || 0),
        })),
      );
      setInvoiceDiscount(Number(invoice.invoiceDiscount || 0));
      setSaving(false);
    }
  }, [open, items, invoice]);

  async function submit() {
    if (!note.trim()) {
      toast.warning('Add a note explaining the edit.');
      return;
    }
    const changes = {};
    const itemChanges = draftItems
      .filter((it) => {
        const original = items.find((o) => o.variantId === it.variant_id);
        if (!original) return true;
        if (Number(original.quantity) !== Number(it.quantity)) return true;
        if (Number(original.unitPrice) !== Number(it.unit_price)) return true;
        if (Number(original.discountAmount || 0) !== Number(it.discount_amount || 0)) return true;
        return false;
      })
      .map((it) => ({
        variant_id: it.variant_id,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        discount_amount: Number(it.discount_amount || 0),
      }));
    if (itemChanges.length) changes.items = itemChanges;
    if (Number(invoiceDiscount) !== Number(invoice.invoiceDiscount || 0)) {
      changes.invoiceDiscount = Number(invoiceDiscount);
    }
    if (!Object.keys(changes).length) {
      toast.warning('Nothing changed — adjust at least one value.');
      return;
    }

    setSaving(true);
    try {
      await createEditRequest(invoice.id, {
        requestNote: note.trim(),
        changes,
      });
      toast.success('Edit request submitted.');
      onSubmitted?.();
    } catch (err) {
      toast.error(err?.message || 'Could not submit edit request.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Request invoice edit"
      subtitle="Manager approval is required before any change is applied."
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Why is this edit needed?"
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Customer returned 1 unit on Section B"
        />

        <div>
          <div className="text-sm font-medium text-ink mb-2">Items</div>
          <ul className="space-y-2">
            {draftItems.map((it, i) => (
              <li
                key={it.variant_id}
                className="rounded-input border border-border bg-surface p-2.5 space-y-1"
              >
                <div className="text-sm text-ink">{it.productName}</div>
                <div className="grid grid-cols-3 gap-2">
                  <NumField
                    label="Qty"
                    value={it.quantity}
                    onChange={(v) =>
                      setDraftItems((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, quantity: v } : x,
                        ),
                      )
                    }
                  />
                  <NumField
                    label="Unit price"
                    value={it.unit_price}
                    onChange={(v) =>
                      setDraftItems((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, unit_price: v } : x,
                        ),
                      )
                    }
                  />
                  <NumField
                    label="Discount"
                    value={it.discount_amount}
                    onChange={(v) =>
                      setDraftItems((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, discount_amount: v } : x,
                        ),
                      )
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <NumField
          label="Invoice-level discount (AED)"
          value={invoiceDiscount}
          onChange={setInvoiceDiscount}
        />
      </div>
    </SlideOver>
  );
}

function NumField({ label, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-ink-muted">{label}</label>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-input border border-border bg-surface px-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
      />
    </div>
  );
}

// ============== Add payment slide-over ================================

function AddPaymentSlideOver({ open, onClose, invoice, onAdded }) {
  const balance = Number(invoice?.balanceDue || 0);
  const [amount, setAmount] = useState(balance);
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
      await addInvoicePayment(invoice.id, {
        method,
        amount: amt,
        notes: notes || null,
      });
      toast.success('Payment recorded.');
      onAdded?.();
    } catch (err) {
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
          onChange={(e) => setAmount(e.target.value)}
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
