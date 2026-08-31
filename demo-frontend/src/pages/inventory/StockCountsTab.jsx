import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, ArrowRight } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Table from '../../components/ui/Table.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { listCounts } from '../../services/stockCountService.js';
import { useAuthStore } from '../../store/authStore.js';
import { formatRelativeTime, formatCurrency } from '../../utils/format.js';
import { onCountEvent, onStockUpdate } from '../../store/socketStore.js';
import StartStockCountModal from './StartStockCountModal.jsx';

const STATUS_TONES = {
  draft: 'muted',
  in_progress: 'warning',
  pending_approval: 'accent',
  approved: 'success',
  rejected: 'error',
};

const TYPE_LABELS = {
  full: 'Full',
  partial: 'Partial',
  category: 'By category',
};

export default function StockCountsTab() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canInitiate = permissions.includes('stock.count_initiate');
  const canSeeCost = permissions.includes('product.view_cost');

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [startOpen, setStartOpen] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await listCounts({ page, limit: 25 });
      setRows(res?.data || []);
      setMeta(res?.meta || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    const unsubA = onCountEvent(() => fetchData());
    const unsubB = onStockUpdate((e) => {
      if (e?.movementType === 'count_correction') fetchData();
    });
    return () => {
      unsubA();
      unsubB();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = meta?.active || null;

  const columns = [
    {
      key: 'type',
      header: 'Type',
      render: (r) => (
        <div>
          <div className="text-sm font-medium text-ink">
            {TYPE_LABELS[r.countType] || r.countType}
          </div>
          {r.categoryName && (
            <div className="text-xs text-ink-muted">{r.categoryName}</div>
          )}
        </div>
      ),
    },
    {
      key: 'initiated',
      header: 'Initiated',
      render: (r) => (
        <div className="text-xs">
          <div className="text-ink">{r.initiatedByUsername || '—'}</div>
          <div className="text-ink-muted">{formatRelativeTime(r.initiatedAt)}</div>
        </div>
      ),
    },
    {
      key: 'products',
      header: 'Products',
      align: 'right',
      render: (r) => (
        <span className="text-sm">
          {r.totalProducts}{' '}
          <span className="text-ink-muted">
            ({r.matchedCount} matched / {r.discrepancyCount} diff)
          </span>
        </span>
      ),
    },
    canSeeCost && {
      key: 'impact',
      header: 'Net value impact',
      align: 'right',
      render: (r) =>
        r.netValueImpact == null ? (
          <span className="text-xs text-ink-muted">—</span>
        ) : (
          <span
            className={
              r.netValueImpact > 0
                ? 'text-success text-sm font-medium'
                : r.netValueImpact < 0
                  ? 'text-error text-sm font-medium'
                  : 'text-sm'
            }
          >
            {r.netValueImpact > 0 ? '+' : ''}
            {formatCurrency(r.netValueImpact)}
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge tone={STATUS_TONES[r.status] || 'muted'} size="sm">
          {r.status.replace('_', ' ')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          rightIcon={<ArrowRight className="h-4 w-4" />}
          onClick={() => navigate(`/inventory/counts/${r.id}`)}
        >
          Open
        </Button>
      ),
    },
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      {activeCount && (
        <div className="rounded-card border border-warning/40 bg-warning-light px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ClipboardList className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-ink">
                Active stock count in progress
              </div>
              <div className="text-xs text-ink-muted">
                {TYPE_LABELS[activeCount.countType]} ·{' '}
                {activeCount.status.replace('_', ' ')} · started{' '}
                {formatRelativeTime(activeCount.initiatedAt)} by{' '}
                {activeCount.initiatedByUsername || '—'}
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            rightIcon={<ArrowRight className="h-4 w-4" />}
            onClick={() => navigate(`/inventory/counts/${activeCount.id}`)}
          >
            Open count
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">Stock count history</h3>
          <p className="text-xs text-ink-muted">
            Initiate, run, and review periodic counts.
          </p>
        </div>
        {canInitiate && (
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setStartOpen(true)}
            disabled={!!activeCount}
          >
            Start stock count
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
            title="No counts yet"
            description="Start your first stock count to verify physical inventory against system records."
            icon={<ClipboardList className="h-5 w-5" />}
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

      <StartStockCountModal
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onCreated={(count) => {
          fetchData();
          if (count?.id) navigate(`/inventory/counts/${count.id}`);
        }}
      />
    </div>
  );
}
