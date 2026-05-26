import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Trash2,
  XCircle,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import SlideOver from '../../components/ui/SlideOver.jsx';
import ReturnStatusBadge from '../../components/ui/ReturnStatusBadge.jsx';
import ReturnTypeBadge from '../../components/ui/ReturnTypeBadge.jsx';
import ConditionBadge from '../../components/ui/ConditionBadge.jsx';
import RefundPreview from '../../components/returns/RefundPreview.jsx';
import PriceDiffCalculator from '../../components/returns/PriceDiffCalculator.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import {
  getReturnRequest,
  approveReturnRequest,
  rejectReturnRequest,
  cancelReturnRequest,
} from '../../services/returnService.js';
import { onReturnEvent } from '../../store/socketStore.js';
import { formatCurrency, formatDateTime, timeAgo } from '../../utils/format.js';

export default function ReturnRequestDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canApprove =
    (user?.permissions || []).includes('return.approve') ||
    (user?.permissions || []).includes('*');

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getReturnRequest(id);
      setRequest(data);
    } catch (err) {
      toast.error(err?.message || 'Failed to load return request.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      onReturnEvent((evt) => {
        if (evt?.requestId === id || evt?.returnOrderId) load();
      }),
    [id, load],
  );

  async function handleApprove() {
    setBusy(true);
    try {
      await approveReturnRequest(id);
      toast.success('Return approved and executed.');
      setApproveOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || 'Failed to approve.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!reason.trim()) {
      toast.error('Please provide a rejection reason.');
      return;
    }
    setBusy(true);
    try {
      await rejectReturnRequest(id, reason.trim());
      toast.success('Return rejected.');
      setRejectOpen(false);
      setReason('');
      await load();
    } catch (err) {
      toast.error(err?.message || 'Failed to reject.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    try {
      await cancelReturnRequest(id);
      toast.success('Return request cancelled.');
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || 'Failed to cancel.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-sm text-ink-muted">Loading return request…</div>
    );
  }
  if (!request) {
    return (
      <div className="p-8 text-sm text-error">Return request not found.</div>
    );
  }

  const isPending = request.status === 'pending';
  const isOwner = request.requestedBy === user?.id;
  const replacement = request.replacementPlan;
  const originalTotal = Number(request.totalValue || 0);
  const replacementTotal = replacement?.items?.reduce(
    (acc, it) => acc + Number(it.unitPrice || 0) * Number(it.quantity || 0),
    0,
  ) || 0;

  return (
    <div className="p-8">
      <PageHeader
        title={request.requestNumber}
        subtitle="Return request details and history."
        action={
          <Button
            variant="ghost"
            onClick={() => navigate('/returns')}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back to returns
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ReturnTypeBadge type={request.returnType} />
                <ReturnStatusBadge status={request.status} />
                {request.noInvoiceReturn && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    No-invoice return
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-ink-muted">
                  Total
                </div>
                <div className="text-xl font-semibold text-ink">
                  {formatCurrency(originalTotal)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm pt-2 border-t border-border">
              <Field label="Reason" value={request.reason?.replace(/_/g, ' ')} capitalize />
              <Field
                label="Requested by"
                value={request.requestedByUsername || '—'}
                hint={formatDateTime(request.requestedAt)}
              />
              {request.invoiceNumber && (
                <Field
                  label="Original invoice"
                  value={
                    <Link
                      to={`/invoices/${request.referenceId}`}
                      className="font-mono text-accent hover:underline"
                    >
                      {request.invoiceNumber}
                    </Link>
                  }
                />
              )}
              {request.customerName && (
                <Field
                  label="Customer"
                  value={
                    <Link
                      to={`/customers/${request.customerId}`}
                      className="text-accent hover:underline"
                    >
                      {request.customerName}
                    </Link>
                  }
                  hint={request.customerPhone}
                />
              )}
              {request.supplierName && (
                <Field
                  label="Supplier"
                  value={
                    <Link
                      to={`/suppliers/${request.supplierId}`}
                      className="text-accent hover:underline"
                    >
                      {request.supplierName}
                    </Link>
                  }
                />
              )}
              {request.approvedByUsername && request.noInvoiceReturn && (
                <Field
                  label="Manager-approved by"
                  value={request.approvedByUsername}
                />
              )}
              {request.reviewedByUsername && (
                <Field
                  label="Reviewed by"
                  value={request.reviewedByUsername}
                  hint={formatDateTime(request.reviewedAt)}
                />
              )}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink mb-2">Request note</h3>
            <p className="text-sm text-ink whitespace-pre-wrap">{request.requestNote}</p>
          </div>

          {request.rejectionReason && (
            <div className="card border border-error/40 bg-error-light p-5">
              <h3 className="text-sm font-semibold text-error mb-1">Rejected</h3>
              <p className="text-sm text-ink whitespace-pre-wrap">
                {request.rejectionReason}
              </p>
            </div>
          )}

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">Items</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-2 pr-3">Product</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Unit</th>
                    <th className="py-2 pr-3">Condition</th>
                    <th className="py-2 pr-3">Serial</th>
                    <th className="py-2 pr-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(request.items || []).map((it) => (
                    <tr key={it.id} className="border-t border-border">
                      <td className="py-2 pr-3">{it.productName}</td>
                      <td className="py-2 pr-3">
                        {it.quantity} {it.unitLabel || ''}
                      </td>
                      <td className="py-2 pr-3">{formatCurrency(it.unitPrice)}</td>
                      <td className="py-2 pr-3">
                        <ConditionBadge condition={it.condition} size="sm" />
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {it.serialNumber || '—'}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium">
                        {formatCurrency(it.totalValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {request.returnType === 'customer_refund' &&
            Array.isArray(request.refundPlan) && (
              <RefundPreview plan={request.refundPlan} total={originalTotal} />
            )}

          {request.returnType === 'customer_replace' && replacement && (
            <div className="card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-ink">Replacement plan</h3>
              <ul className="space-y-1.5 text-sm">
                {(replacement.items || []).map((r, idx) => (
                  <li key={idx} className="flex justify-between">
                    <span>
                      {r.productName || 'Variant'}{' '}
                      <span className="text-ink-muted">× {r.quantity}</span>
                    </span>
                    <span className="font-medium">
                      {formatCurrency(Number(r.quantity) * Number(r.unitPrice))}
                    </span>
                  </li>
                ))}
              </ul>
              <PriceDiffCalculator
                originalValue={originalTotal}
                replacementValue={replacementTotal}
              />
            </div>
          )}

          {request.order && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink mb-2">
                Execution
              </h3>
              <p className="text-sm">
                Return order{' '}
                <Link
                  to={`/returns/orders/${request.order.id}`}
                  className="font-mono text-accent hover:underline"
                >
                  {request.order.returnOrderNumber}
                </Link>{' '}
                created on {formatDateTime(request.order.createdAt)}.
                {request.order.refundTotal > 0 && (
                  <span>
                    {' '}
                    Refunded {formatCurrency(request.order.refundTotal)}.
                  </span>
                )}
                {request.order.replacementInvoiceId && (
                  <span>
                    {' '}
                    Replacement invoice{' '}
                    <Link
                      to={`/invoices/${request.order.replacementInvoiceId}`}
                      className="text-accent hover:underline"
                    >
                      created
                    </Link>
                    .
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink mb-3">History</h3>
            <ol className="space-y-3">
              {(request.history || []).map((h) => (
                <li key={h.id} className="flex items-start gap-2">
                  <div className="mt-1 h-2 w-2 rounded-full bg-accent" />
                  <div>
                    <div className="text-sm font-medium capitalize text-ink">
                      {h.action.replace(/_/g, ' ')}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {timeAgo(h.timestamp)} · {h.performedByUsername || '—'}
                    </div>
                    {h.notes && (
                      <div className="text-xs text-ink mt-1 whitespace-pre-wrap">
                        “{h.notes}”
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {isPending && (
            <div className="card p-5 space-y-2">
              <h3 className="text-sm font-semibold text-ink">Actions</h3>
              {canApprove && (
                <>
                  <Button
                    className="w-full"
                    onClick={() => setApproveOpen(true)}
                    leftIcon={<CheckCircle2 className="h-4 w-4" />}
                  >
                    Approve & execute
                  </Button>
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => setRejectOpen(true)}
                    leftIcon={<XCircle className="h-4 w-4" />}
                  >
                    Reject
                  </Button>
                </>
              )}
              {isOwner && (
                <Button
                  className="w-full"
                  variant="ghost"
                  onClick={() => setCancelOpen(true)}
                  leftIcon={<Trash2 className="h-4 w-4" />}
                >
                  Cancel request
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={approveOpen}
        title="Approve and execute return?"
        description="Stock will be moved, refunds issued and warranties updated immediately. This cannot be undone from this screen."
        confirmLabel="Approve"
        variant="primary"
        loading={busy}
        onConfirm={handleApprove}
        onClose={() => setApproveOpen(false)}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this return request?"
        description="Only pending requests can be cancelled. The original transaction will remain unchanged."
        confirmLabel="Cancel request"
        variant="danger"
        loading={busy}
        onConfirm={handleCancel}
        onClose={() => setCancelOpen(false)}
      />

      <SlideOver
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject return request"
        width="md"
      >
        <div className="space-y-4 p-4">
          <p className="text-sm text-ink">
            Provide a reason that will be shared with the requester.
          </p>
          <Textarea
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this return cannot be approved…"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleReject}
              loading={busy}
              variant="primary"
              leftIcon={<XCircle className="h-4 w-4" />}
            >
              Reject return
            </Button>
          </div>
        </div>
      </SlideOver>

      {!isPending && <Clock className="hidden" />}
    </div>
  );
}

function Field({ label, value, hint, capitalize = false }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className={`text-sm text-ink ${capitalize ? 'capitalize' : ''}`}>
        {value || '—'}
      </div>
      {hint && <div className="text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
