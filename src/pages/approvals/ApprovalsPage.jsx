import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Inbox,
  RefreshCw,
  X,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useNotificationStore } from '../../store/notificationStore.js';
import { getApprovalQueue } from '../../services/notificationService.js';
import { approveAdjustment, rejectAdjustment } from '../../services/adjustmentService.js';
import { approveCount, rejectCount } from '../../services/stockCountService.js';
import { approveReturnRequest, rejectReturnRequest } from '../../services/returnService.js';
import {
  approveEditRequest,
  rejectEditRequest,
} from '../../services/invoiceEditRequestService.js';
import { approveLeave, rejectLeave } from '../../services/leaveService.js';
import {
  approveCorrection,
  rejectCorrection,
} from '../../services/attendanceService.js';
import { toast } from '../../store/toastStore.js';
import { timeAgo, formatCurrency } from '../../utils/format.js';

function Section({ title, count, items, empty, onSeeAll, children }) {
  return (
    <div className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {count > 0 && (
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
              {count}
            </span>
          )}
        </div>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            View all
            <ChevronRight size={14} />
          </button>
        )}
      </header>
      <div className="divide-y divide-border">
        {!items || items.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-ink-muted">{empty}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function ActionRow({ children, onApprove, onReject, busy }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="primary"
          onClick={onApprove}
          disabled={busy}
          title="Approve"
        >
          <Check size={14} />
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReject}
          disabled={busy}
          title="Reject"
        >
          <X size={14} />
          Reject
        </Button>
      </div>
    </div>
  );
}

function promptReason(label) {
  // Simple prompt — replace with a richer dialog if the design system has one.
  const r = window.prompt(`${label}: please enter a reason (min 3 characters):`);
  if (!r || r.trim().length < 3) {
    if (r !== null) toast.warning('Reason must be at least 3 characters.');
    return null;
  }
  return r.trim();
}

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const fetchApprovalCount = useNotificationStore((s) => s.fetchApprovalCount);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const queue = await getApprovalQueue(10);
      setData(queue);
      fetchApprovalCount?.();
    } catch (err) {
      toast.error(err.message || 'Could not load approvals queue.');
    } finally {
      setLoading(false);
    }
  }, [fetchApprovalCount]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (role !== 'Admin' && role !== 'Manager') {
    return (
      <div className="card p-8 text-center text-ink-muted">
        <AlertTriangle size={24} className="mx-auto mb-2 text-warning" />
        <p className="text-sm">You don't have access to approvals.</p>
      </div>
    );
  }

  const total =
    (data?.returns?.length || 0) +
    (data?.invoice_edits?.length || 0) +
    (data?.stock_adjustments?.length || 0) +
    (data?.stock_counts?.length || 0) +
    (data?.attendance_corrections?.length || 0) +
    (data?.leaves?.length || 0);

  async function withBusy(key, fn) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(err.message || 'Action failed.');
    } finally {
      setBusy(null);
      await load();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        subtitle={`${total} item${total === 1 ? '' : 's'} need your attention right now.`}
        action={
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        }
      />

      {loading && !data ? (
        <div className="card p-8 text-center text-sm text-ink-muted">
          Loading approval queue…
        </div>
      ) : total === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-ink-muted">
          <Inbox size={32} className="opacity-50" />
          <p className="text-sm font-medium text-ink">No pending approvals 🎉</p>
          <p className="text-xs">You're caught up across every workflow.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section
            title="Return Requests"
            count={data?.returns?.length || 0}
            items={data?.returns}
            empty="No pending return requests."
            onSeeAll={() => navigate('/returns')}
          >
            {(data?.returns || []).map((r) => (
              <ActionRow
                key={r.id}
                busy={busy === `return:${r.id}`}
                onApprove={() =>
                  withBusy(`return:${r.id}`, () => approveReturnRequest(r.id))
                }
                onReject={() => {
                  const reason = promptReason('Reject return');
                  if (reason)
                    withBusy(`return:${r.id}`, () =>
                      rejectReturnRequest(r.id, reason),
                    );
                }}
              >
                <div className="flex items-center gap-2">
                  <Link
                    to={`/returns/requests/${r.id}`}
                    className="text-sm font-semibold text-ink hover:text-accent"
                  >
                    {r.request_number}
                  </Link>
                  {r.no_invoice_return && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-error-light px-1.5 py-0.5 text-[10px] font-medium text-error">
                      <AlertTriangle size={10} />
                      No invoice
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-ink-muted">
                  {r.customer_name || 'Walk-in'} ·{' '}
                  {formatCurrency(r.total_value || 0)} · {timeAgo(r.requested_at)}
                </p>
              </ActionRow>
            ))}
          </Section>

          <Section
            title="Invoice Edit Requests"
            count={data?.invoice_edits?.length || 0}
            items={data?.invoice_edits}
            empty="No invoice edit requests."
            onSeeAll={() => navigate('/invoices/edit-requests')}
          >
            {(data?.invoice_edits || []).map((r) => (
              <ActionRow
                key={r.id}
                busy={busy === `edit:${r.id}`}
                onApprove={() =>
                  withBusy(`edit:${r.id}`, () =>
                    approveEditRequest(r.invoice_id, r.id),
                  )
                }
                onReject={() => {
                  const reason = promptReason('Reject edit');
                  if (reason)
                    withBusy(`edit:${r.id}`, () =>
                      rejectEditRequest(r.invoice_id, r.id, reason),
                    );
                }}
              >
                <Link
                  to={`/invoices/${r.invoice_id}`}
                  className="text-sm font-semibold text-ink hover:text-accent"
                >
                  {r.invoice_number}
                </Link>
                <p className="truncate text-xs text-ink-muted">
                  {r.requested_by_name || 'User'} · {timeAgo(r.requested_at)}
                </p>
              </ActionRow>
            ))}
          </Section>

          <Section
            title="Stock Adjustments"
            count={data?.stock_adjustments?.length || 0}
            items={data?.stock_adjustments}
            empty="No stock adjustments awaiting review."
            onSeeAll={() => navigate('/inventory')}
          >
            {(data?.stock_adjustments || []).map((a) => (
              <ActionRow
                key={a.id}
                busy={busy === `adj:${a.id}`}
                onApprove={() =>
                  withBusy(`adj:${a.id}`, () => approveAdjustment(a.id))
                }
                onReject={() => {
                  const reason = promptReason('Reject adjustment');
                  if (reason)
                    withBusy(`adj:${a.id}`, () =>
                      rejectAdjustment(a.id, reason),
                    );
                }}
              >
                <p className="text-sm font-semibold text-ink">
                  {a.product_name}{' '}
                  <span className="font-normal text-ink-muted">
                    {a.difference > 0 ? '+' : ''}
                    {a.difference}
                  </span>
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {a.reason} · {a.requested_by_name || 'User'} ·{' '}
                  {timeAgo(a.requested_at)}
                </p>
              </ActionRow>
            ))}
          </Section>

          <Section
            title="Stock Counts"
            count={data?.stock_counts?.length || 0}
            items={data?.stock_counts}
            empty="No stock counts awaiting review."
            onSeeAll={() => navigate('/inventory/counts')}
          >
            {(data?.stock_counts || []).map((c) => (
              <ActionRow
                key={c.id}
                busy={busy === `cnt:${c.id}`}
                onApprove={() => withBusy(`cnt:${c.id}`, () => approveCount(c.id))}
                onReject={() => {
                  const reason = promptReason('Reject count');
                  if (reason)
                    withBusy(`cnt:${c.id}`, () => rejectCount(c.id, reason));
                }}
              >
                <p className="text-sm font-semibold text-ink">
                  {c.count_type === 'full'
                    ? 'Full inventory count'
                    : c.count_type === 'partial'
                      ? 'Partial count'
                      : 'Category count'}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {c.discrepancy_count || 0} discrepancies ·{' '}
                  {c.submitted_by_name || 'User'} · {timeAgo(c.submitted_at)}
                </p>
              </ActionRow>
            ))}
          </Section>

          <Section
            title="Attendance Corrections"
            count={data?.attendance_corrections?.length || 0}
            items={data?.attendance_corrections}
            empty="No attendance corrections pending."
            onSeeAll={() => navigate('/attendance')}
          >
            {(data?.attendance_corrections || []).map((c) => (
              <ActionRow
                key={c.id}
                busy={busy === `corr:${c.id}`}
                onApprove={() =>
                  withBusy(`corr:${c.id}`, () => approveCorrection(c.id))
                }
                onReject={() => {
                  const reason = promptReason('Reject correction');
                  if (reason)
                    withBusy(`corr:${c.id}`, () => rejectCorrection(c.id, reason));
                }}
              >
                <p className="text-sm font-semibold text-ink">
                  {c.employee_name || 'Employee'} · {c.attendance_date}
                </p>
                <p className="truncate text-xs text-ink-muted">{c.reason}</p>
              </ActionRow>
            ))}
          </Section>

          <Section
            title="Leave Requests"
            count={data?.leaves?.length || 0}
            items={data?.leaves}
            empty="No leave requests pending."
            onSeeAll={() => navigate('/attendance?tab=leaves')}
          >
            {(data?.leaves || []).map((l) => (
              <ActionRow
                key={l.id}
                busy={busy === `lv:${l.id}`}
                onApprove={() => withBusy(`lv:${l.id}`, () => approveLeave(l.id))}
                onReject={() => {
                  const reason = promptReason('Reject leave');
                  if (reason)
                    withBusy(`lv:${l.id}`, () => rejectLeave(l.id, reason));
                }}
              >
                <p className="text-sm font-semibold text-ink">
                  {l.employee_name} · {l.leave_type}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {l.start_date} → {l.end_date} ({l.total_days}d) ·{' '}
                  {timeAgo(l.created_at)}
                </p>
              </ActionRow>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}
