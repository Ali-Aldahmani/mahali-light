import { useEffect, useState } from 'react';
import { Plus, Check, X, Search } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Table from '../../components/ui/Table.jsx';
import SlideOver from '../../components/ui/SlideOver.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import StockImpactPreview from '../../components/ui/StockImpactPreview.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import {
  listAdjustments,
  approveAdjustment,
  rejectAdjustment,
} from '../../services/adjustmentService.js';
import { useAuthStore } from '../../store/authStore.js';
import { useInventoryStore } from '../../store/inventoryStore.js';
import { toast } from '../../store/toastStore.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { formatQty, formatRelativeTime } from '../../utils/format.js';
import { onAdjustmentEvent } from '../../store/socketStore.js';
import RequestAdjustmentSlideOver from './RequestAdjustmentSlideOver.jsx';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const REASON_LABELS = {
  damaged: 'Damaged',
  lost: 'Lost',
  found: 'Found',
  counting_error: 'Counting error',
  expired: 'Expired',
  other: 'Other',
};

const STATUS_TONES = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

export default function AdjustmentsTab() {
  const permissions = useAuthStore((s) => s.permissions);
  const canApprove = permissions.includes('stock.adjust_approve');
  const canRequest = permissions.includes('stock.adjust_request');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);

  const [requestOpen, setRequestOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [reviewMode, setReviewMode] = useState('approve'); // 'approve' | 'reject'
  const [reviewBusy, setReviewBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);

  const refreshInventory = useInventoryStore((s) => s.refreshAll);
  const refreshBadge = useInventoryStore((s) => s.refreshAdjustmentsBadge);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await listAdjustments({
        page,
        limit: 25,
        status: status === 'all' ? undefined : status,
        search: debouncedSearch || undefined,
      });
      setRows(res?.data || []);
      setMeta(res?.meta || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, debouncedSearch]);

  useEffect(() => {
    const unsub = onAdjustmentEvent(() => {
      fetchData();
      refreshBadge?.();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openReview(req, mode) {
    setReviewRequest(req);
    setReviewMode(mode);
    setRejectionReason('');
    setReviewOpen(true);
  }

  async function handleApprove() {
    if (!reviewRequest) return;
    setReviewBusy(true);
    try {
      await approveAdjustment(reviewRequest.id);
      toast.success('Adjustment approved.');
      setReviewOpen(false);
      fetchData();
      refreshInventory();
      refreshBadge();
    } catch (err) {
      toast.error(err?.message || 'Failed to approve.');
    } finally {
      setReviewBusy(false);
    }
  }

  async function handleReject() {
    if (!reviewRequest || rejectionReason.trim().length < 3) return;
    setReviewBusy(true);
    try {
      await rejectAdjustment(reviewRequest.id, rejectionReason.trim());
      toast.success('Adjustment rejected.');
      setReviewOpen(false);
      setRejectConfirmOpen(false);
      fetchData();
      refreshBadge();
    } catch (err) {
      toast.error(err?.message || 'Failed to reject.');
    } finally {
      setReviewBusy(false);
    }
  }

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-ink truncate">{r.productName}</div>
          <div className="text-xs text-ink-muted truncate">{r.variantSku}</div>
        </div>
      ),
    },
    {
      key: 'change',
      header: 'Change',
      align: 'right',
      render: (r) => (
        <div className="flex flex-col items-end">
          <span className="text-xs text-ink-muted">
            {formatQty(r.currentQty)} → {formatQty(r.requestedQty)}
          </span>
          <span
            className={
              r.difference > 0
                ? 'text-success font-semibold'
                : r.difference < 0
                  ? 'text-error font-semibold'
                  : 'font-medium'
            }
          >
            {r.difference > 0 ? '+' : ''}
            {formatQty(r.difference)}
            {r.unitLabel ? ` ${r.unitLabel}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => (
        <span className="text-sm">{REASON_LABELS[r.reason] || r.reason}</span>
      ),
    },
    {
      key: 'requested',
      header: 'Requested by',
      render: (r) => (
        <div className="text-xs">
          <div className="text-ink">{r.requestedByUsername || '—'}</div>
          <div className="text-ink-muted">
            {formatRelativeTime(r.requestedAt)}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={STATUS_TONES[r.status] || 'muted'} size="sm">
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        canApprove && r.status === 'pending' ? (
          <div className="flex gap-1.5 justify-end">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<X className="h-4 w-4" />}
              onClick={() => openReview(r, 'reject')}
            >
              Reject
            </Button>
            <Button
              size="sm"
              leftIcon={<Check className="h-4 w-4" />}
              onClick={() => openReview(r, 'approve')}
            >
              Approve
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openReview(r, 'view')}
          >
            View
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <Input
            placeholder="Search by product name or SKU…"
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="w-44">
          <Select
            value={status}
            onChange={(v) => {
              setPage(1);
              setStatus(v);
            }}
            options={STATUS_OPTIONS}
            searchable={false}
          />
        </div>
        {canRequest && (
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setRequestOpen(true)}
          >
            Request adjustment
          </Button>
        )}
      </div>

      <Table
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty={
          <EmptyState
            title="No adjustments here"
            description="No stock adjustment requests match the current filters."
          />
        }
        pagination={
          meta
            ? {
                page,
                pageSize: meta.limit || 25,
                total: meta.total || 0,
                onPageChange: setPage,
              }
            : null
        }
      />

      <PermissionGate permission="stock.adjust_request">
        <RequestAdjustmentSlideOver
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          onSuccess={() => {
            fetchData();
            refreshBadge();
          }}
        />
      </PermissionGate>

      {/* Review slide-over */}
      <SlideOver
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        width="md"
        title={
          reviewMode === 'reject'
            ? 'Reject adjustment'
            : reviewMode === 'approve'
              ? 'Approve adjustment'
              : 'Adjustment request'
        }
        subtitle={reviewRequest?.productName}
        footer={
          reviewRequest?.status === 'pending' && canApprove ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setReviewOpen(false)}
                disabled={reviewBusy}
              >
                Cancel
              </Button>
              {reviewMode === 'reject' ? (
                <Button
                  variant="danger"
                  disabled={rejectionReason.trim().length < 3 || reviewBusy}
                  onClick={() => setRejectConfirmOpen(true)}
                >
                  Confirm rejection
                </Button>
              ) : (
                <Button onClick={handleApprove} loading={reviewBusy}>
                  Confirm approval
                </Button>
              )}
            </>
          ) : null
        }
      >
        {reviewRequest && (
          <div className="space-y-4">
            <StockImpactPreview
              beforeQty={reviewRequest.currentQty}
              afterQty={reviewRequest.requestedQty}
              unitLabel={reviewRequest.unitLabel}
              showValue={false}
            />

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Reason" value={REASON_LABELS[reviewRequest.reason] || reviewRequest.reason} />
              <Field label="Requested by" value={reviewRequest.requestedByUsername || '—'} />
              <Field
                label="Status"
                value={
                  <Badge tone={STATUS_TONES[reviewRequest.status] || 'muted'} size="sm">
                    {reviewRequest.status}
                  </Badge>
                }
              />
              <Field
                label="Requested"
                value={formatRelativeTime(reviewRequest.requestedAt)}
              />
            </div>

            <Field label="Note" value={reviewRequest.requestNote} block />

            {reviewRequest.status === 'rejected' &&
              reviewRequest.rejectionReason && (
                <Field
                  label="Rejection reason"
                  value={reviewRequest.rejectionReason}
                  block
                />
              )}

            {reviewMode === 'reject' && reviewRequest.status === 'pending' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">
                  Rejection reason <span className="text-error">*</span>
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
                  rows={3}
                  placeholder="Explain why this request is being rejected"
                />
              </div>
            )}
          </div>
        )}
      </SlideOver>

      <ConfirmDialog
        open={rejectConfirmOpen}
        onClose={() => setRejectConfirmOpen(false)}
        onConfirm={handleReject}
        title="Reject this adjustment?"
        description="The requester will be notified with your reason. This action cannot be undone."
        confirmLabel="Reject"
        variant="danger"
        loading={reviewBusy}
      />
    </div>
  );
}

function Field({ label, value, block = false }) {
  return (
    <div className={block ? '' : ''}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-sm text-ink mt-0.5 ${block ? 'whitespace-pre-wrap' : ''}`}>{value}</div>
    </div>
  );
}
