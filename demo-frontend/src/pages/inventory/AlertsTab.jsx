import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, X, RefreshCw, Bell } from 'lucide-react';
import Button from '../../components/ui/Button.jsx';
import Table from '../../components/ui/Table.jsx';
import Badge from '../../components/ui/Badge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import {
  listReorderAlerts,
  dismissReorderAlert,
  runReorderCheck,
} from '../../services/reorderService.js';
import { useInventoryStore } from '../../store/inventoryStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { formatQty, formatRelativeTime } from '../../utils/format.js';
import { toast } from '../../store/toastStore.js';
import { fileUrl } from '../../config.js';
import { onReorderAlert, onStockUpdate } from '../../store/socketStore.js';

export default function AlertsTab() {
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const canDismiss = permissions.includes('stock.adjust_approve');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDismissId, setConfirmDismissId] = useState(null);
  const [running, setRunning] = useState(false);

  const refreshInventoryAlerts = useInventoryStore((s) => s.refreshAlerts);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await listReorderAlerts('pending');
      setRows(res?.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const unsubA = onReorderAlert(() => {
      fetchData();
      refreshInventoryAlerts?.();
    });
    const unsubB = onStockUpdate(() => fetchData());
    return () => {
      unsubA();
      unsubB();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDismiss() {
    if (!confirmDismissId) return;
    try {
      await dismissReorderAlert(confirmDismissId);
      toast.success('Alert dismissed.');
      setConfirmDismissId(null);
      fetchData();
      refreshInventoryAlerts?.();
    } catch (err) {
      toast.error(err?.message || 'Failed to dismiss.');
    }
  }

  async function handleRefreshScan() {
    setRunning(true);
    try {
      const res = await runReorderCheck();
      toast.success(
        `Scanned ${res?.scanned ?? 0} variants. Created ${res?.created ?? 0} new alerts.`,
      );
      fetchData();
      refreshInventoryAlerts?.();
    } catch (err) {
      toast.error(err?.message || 'Scan failed.');
    } finally {
      setRunning(false);
    }
  }

  const columns = [
    {
      key: 'product',
      header: 'Product',
      render: (r) => (
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded bg-surface-2 overflow-hidden flex items-center justify-center text-xs text-ink-muted shrink-0">
            {r.productImage ? (
              <img
                src={fileUrl(r.productImage)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              '—'
            )}
          </div>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate(`/products/${r.productId}`)}
              className="text-sm font-medium text-ink hover:text-accent text-left truncate block max-w-[260px]"
              title={r.productName}
            >
              {r.productName}
            </button>
            <div className="text-xs text-ink-muted truncate">
              {r.categoryName || '—'} · SKU {r.sku}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'current',
      header: 'Current stock',
      align: 'right',
      render: (r) => (
        <Badge tone={r.currentStock <= 0 ? 'error' : 'warning'} size="sm" dot>
          {formatQty(r.currentStock)} {r.unitLabel || ''}
        </Badge>
      ),
    },
    {
      key: 'reorder',
      header: 'Reorder point',
      align: 'right',
      render: (r) => (
        <span className="text-sm">
          {formatQty(r.reorderPoint)} {r.unitLabel || ''}
        </span>
      ),
    },
    {
      key: 'recommended',
      header: 'Recommended order',
      align: 'right',
      render: (r) => (
        <span className="text-sm font-medium text-ink">
          {formatQty(r.recommendedOrderQty)} {r.unitLabel || ''}
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Raised',
      render: (r) => (
        <span className="text-xs text-ink-muted">
          {formatRelativeTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<ShoppingCart className="h-4 w-4" />}
            disabled
            title="Available once Purchase Orders are enabled (Phase 4)"
          >
            Create PO
          </Button>
          {canDismiss && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<X className="h-4 w-4" />}
              onClick={() => setConfirmDismissId(r.id)}
            >
              Dismiss
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">Reorder alerts</h3>
          <p className="text-xs text-ink-muted">
            Products at or below their reorder threshold.
          </p>
        </div>
        {canDismiss && (
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={handleRefreshScan}
            loading={running}
          >
            Run reorder check
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
            title="All stock levels are healthy"
            description="No active reorder alerts."
            icon={<Bell className="h-5 w-5" />}
          />
        }
      />

      <ConfirmDialog
        open={!!confirmDismissId}
        onClose={() => setConfirmDismissId(null)}
        onConfirm={handleDismiss}
        title="Dismiss this alert?"
        description="The alert will be removed from the active list. A new one may be raised automatically if stock continues to be low."
        confirmLabel="Dismiss"
        variant="danger"
      />
    </div>
  );
}
