'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Save,
  Send,
  Check,
  X,
  ArrowLeft,
  CheckSquare,
  AlertTriangle,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Table from '@/components/ui/Table';
import CountProgressBar from '@/components/ui/CountProgressBar';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import SlideOver from '@/components/ui/SlideOver';
import RequirePermission from '@/components/guards/RequirePermission';
import {
  getCount,
  updateCountItems,
  submitCount,
  approveCount,
  rejectCount,
} from '@/services/stockCountService';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { fileUrl } from '@/lib/config';
import {
  formatQty,
  formatCurrency,
  formatRelativeTime,
} from '@/lib/utils/format';
import { onCountEvent } from '@/store/socketStore';

const STATUS_TONES: Record<string, string> = {
  draft: 'muted',
  in_progress: 'warning',
  pending_approval: 'accent',
  approved: 'success',
  rejected: 'error',
};

const TYPE_LABELS: Record<string, string> = {
  full: 'Full count',
  partial: 'Partial count',
  category: 'Category count',
};

function StockCountDetailPageContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const permissions = useAuthStore((s) => s.permissions);
  const canApprove = permissions.includes('stock.count_approve');
  const canSeeCost = permissions.includes('product.view_cost');

  const [count, setCount] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, any>>({}); // id -> { countedQty, notes }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getCount(id);
      setCount(res);
      setItems(res.items || []);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const unsub = onCountEvent((e: any) => {
      if (e?.countId === id) fetchData();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const editable = count?.status === 'in_progress' || count?.status === 'draft';
  const reviewable = count?.status === 'pending_approval' && canApprove;

  const stats = useMemo(() => {
    let counted = 0;
    let discrepancies = 0;
    let netValue = 0;
    for (const it of items) {
      const draft = drafts[it.id];
      const value =
        draft && draft.countedQty !== undefined && draft.countedQty !== ''
          ? Number(draft.countedQty)
          : it.countedQty;
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        counted++;
        const diff = value - Number(it.systemQty);
        if (diff !== 0) discrepancies++;
        if (canSeeCost && it.costPrice != null) {
          netValue += diff * Number(it.costPrice);
        }
      }
    }
    return { counted, discrepancies, netValue, total: items.length };
  }, [items, drafts, canSeeCost]);

  function updateDraft(itemId: string, field: string, value: any) {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [field]: value,
      },
    }));
  }

  function effectiveCounted(it: any) {
    const draft = drafts[it.id];
    if (draft && draft.countedQty !== undefined) {
      return draft.countedQty === '' ? null : Number(draft.countedQty);
    }
    return it.countedQty;
  }

  async function saveDrafts() {
    const ids = Object.keys(drafts);
    if (!ids.length) return;
    setSaving(true);
    try {
      const payload = ids.map((itemId) => ({
        id: itemId,
        countedQty:
          drafts[itemId].countedQty === '' || drafts[itemId].countedQty === null
            ? null
            : Number(drafts[itemId].countedQty),
        notes: drafts[itemId].notes ?? undefined,
      }));
      await updateCountItems(id, payload);
      toast.success(`Saved ${ids.length} item${ids.length === 1 ? '' : 's'}.`);
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function applyBulkMatchAll() {
    setBulkConfirmOpen(false);
    const next: Record<string, any> = {};
    for (const it of items) {
      next[it.id] = {
        ...(drafts[it.id] || {}),
        countedQty: Number(it.systemQty),
      };
    }
    setDrafts(next);
    toast.info('All uncounted items set to match system quantities. Click Save to persist.');
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      if (Object.keys(drafts).length) await saveDrafts();
      await submitCount(id);
      toast.success('Count submitted for approval.');
      setSubmitConfirmOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove() {
    setSubmitting(true);
    try {
      await approveCount(id);
      toast.success('Count approved. Stock corrections applied.');
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || 'Approval failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (rejectionReason.trim().length < 3) return;
    setSubmitting(true);
    try {
      await rejectCount(id, rejectionReason.trim());
      toast.success('Count rejected.');
      setRejectOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || 'Reject failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="card p-8 text-center text-ink-muted">Loading count…</div>
    );
  }
  if (!count) {
    return (
      <div className="card p-8 text-center text-ink-muted">Count not found.</div>
    );
  }

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (it: any) => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded bg-surface-2 overflow-hidden flex items-center justify-center text-xs text-ink-muted shrink-0">
            {it.productImage ? (
              <img
                src={fileUrl(it.productImage)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              '—'
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              {it.productName}
            </div>
            <div className="text-xs text-ink-muted truncate">SKU {it.sku}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'system',
      header: 'System qty',
      align: 'right' as const,
      render: (it: any) => (
        <span className="text-sm">
          {formatQty(it.systemQty)} {it.unitLabel || ''}
        </span>
      ),
    },
    {
      key: 'counted',
      header: 'Counted',
      align: 'right' as const,
      render: (it: any) => {
        if (!editable) {
          return (
            <span className="text-sm">
              {it.countedQty == null ? '—' : `${formatQty(it.countedQty)} ${it.unitLabel || ''}`}
            </span>
          );
        }
        const draftVal =
          drafts[it.id]?.countedQty !== undefined
            ? drafts[it.id].countedQty
            : it.countedQty == null
              ? ''
              : String(it.countedQty);
        return (
          <input
            type="number"
            step="0.01"
            min="0"
            value={draftVal}
            onChange={(e) => updateDraft(it.id, 'countedQty', e.target.value)}
            className="w-28 rounded-input border border-border bg-surface px-2 py-1.5 text-sm text-right focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
            placeholder="0"
          />
        );
      },
    },
    {
      key: 'diff',
      header: 'Difference',
      align: 'right' as const,
      render: (it: any) => {
        const counted = effectiveCounted(it);
        if (counted == null || counted === '') {
          return <span className="text-xs text-ink-muted">—</span>;
        }
        const diff = Number(counted) - Number(it.systemQty);
        return (
          <span
            className={
              diff > 0
                ? 'text-success font-semibold'
                : diff < 0
                  ? 'text-error font-semibold'
                  : 'text-success font-medium'
            }
          >
            {diff > 0 ? '+' : ''}
            {formatQty(diff)} {it.unitLabel || ''}
          </span>
        );
      },
    },
    canSeeCost && {
      key: 'value',
      header: 'Value impact',
      align: 'right' as const,
      render: (it: any) => {
        const counted = effectiveCounted(it);
        if (counted == null || counted === '' || it.costPrice == null) {
          return <span className="text-xs text-ink-muted">—</span>;
        }
        const impact =
          (Number(counted) - Number(it.systemQty)) * Number(it.costPrice);
        return (
          <span
            className={
              impact > 0
                ? 'text-success text-sm font-medium'
                : impact < 0
                  ? 'text-error text-sm font-medium'
                  : 'text-sm'
            }
          >
            {impact > 0 ? '+' : ''}
            {formatCurrency(impact)}
          </span>
        );
      },
    },
  ].filter(Boolean) as any[];

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => router.push('/inventory?tab=counts')}
            >
              Back
            </Button>
            <span>{TYPE_LABELS[count.countType] || count.countType}</span>
            <Badge tone={STATUS_TONES[count.status] || 'muted'} size="md">
              {count.status.replace('_', ' ')}
            </Badge>
          </span>
        }
        subtitle={`Initiated ${formatRelativeTime(count.initiatedAt)} by ${count.initiatedByUsername || '—'}`}
      />

      <div className="grid grid-cols-4 gap-4">
        <Card label="Total items" value={count.totalProducts} />
        <Card
          label="Counted"
          value={`${stats.counted}/${stats.total}`}
        />
        <Card
          label="Discrepancies"
          value={stats.discrepancies}
          tone={stats.discrepancies > 0 ? 'warning' : 'default'}
        />
        {canSeeCost && (
          <Card
            label="Net value impact"
            value={formatCurrency(stats.netValue)}
            tone={
              stats.netValue > 0 ? 'success' : stats.netValue < 0 ? 'error' : 'default'
            }
          />
        )}
      </div>

      <CountProgressBar counted={stats.counted} total={stats.total} />

      {count.status === 'rejected' && count.rejectionReason && (
        <div className="rounded-input bg-error-light text-error px-3 py-2 text-sm">
          Rejected by {count.approvedByUsername || '—'}: {count.rejectionReason}
        </div>
      )}

      {editable && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            leftIcon={<CheckSquare className="h-4 w-4" />}
            onClick={() => setBulkConfirmOpen(true)}
          >
            Mark uncounted as matching
          </Button>
          <Button
            variant="secondary"
            leftIcon={<Save className="h-4 w-4" />}
            onClick={saveDrafts}
            loading={saving}
            disabled={!Object.keys(drafts).length}
          >
            Save progress
          </Button>
          <div className="ml-auto">
            <Button
              leftIcon={<Send className="h-4 w-4" />}
              onClick={() => setSubmitConfirmOpen(true)}
              disabled={stats.counted === 0}
            >
              Submit for approval
            </Button>
          </div>
        </div>
      )}

      {reviewable && (
        <div className="flex items-center gap-2">
          {stats.discrepancies > 0 && (
            <div className="flex items-center gap-2 text-warning text-sm">
              <AlertTriangle className="h-4 w-4" />
              {stats.discrepancies} discrepancies found, net impact{' '}
              {canSeeCost ? formatCurrency(stats.netValue) : 'hidden'}
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              leftIcon={<X className="h-4 w-4" />}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
            <Button
              leftIcon={<Check className="h-4 w-4" />}
              onClick={handleApprove}
              loading={submitting}
            >
              Approve count
            </Button>
          </div>
        </div>
      )}

      <Table columns={columns} rows={items} rowKey={(i: any) => i.id} />

      <ConfirmDialog
        open={submitConfirmOpen}
        onClose={() => setSubmitConfirmOpen(false)}
        onConfirm={handleSubmit}
        title="Submit count for approval?"
        description={`${stats.counted} of ${stats.total} items counted. ${stats.discrepancies} discrepancies found${canSeeCost ? `, net value impact ${formatCurrency(stats.netValue)}` : ''}. A manager will need to approve before stock is corrected.`}
        confirmLabel="Submit"
        loading={submitting}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        onClose={() => setBulkConfirmOpen(false)}
        onConfirm={applyBulkMatchAll}
        title="Mark uncounted items as matching?"
        description="All uncounted items will be set equal to their system quantity. You can still adjust individual rows before saving."
        confirmLabel="Continue"
      />

      <SlideOver
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject stock count"
        width="md"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRejectOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={rejectionReason.trim().length < 3 || submitting}
              loading={submitting}
            >
              Reject
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            The count will be marked as rejected and the initiator will be
            notified.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink">
              Rejection reason <span className="text-error">*</span>
            </label>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
              className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none"
              placeholder="Explain why this count is being rejected"
            />
          </div>
        </div>
      </SlideOver>
    </div>
  );
}

function Card({ label, value, tone = 'default' }: { label: string; value: any; tone?: string }) {
  const TONES: Record<string, string> = {
    default: 'text-ink',
    warning: 'text-warning',
    error: 'text-error',
    success: 'text-success',
  };
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${TONES[tone]}`}>{value}</div>
    </div>
  );
}

export default function StockCountDetailPage() {
  return (
    <RequirePermission permission="stock.view">
      <StockCountDetailPageContent />
    </RequirePermission>
  );
}
