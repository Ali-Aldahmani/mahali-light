import { create } from 'zustand';
import { getStockSummary } from '@/services/stockService';
import { listAdjustments } from '@/services/adjustmentService';
import { listReorderAlerts } from '@/services/reorderService';

interface ReorderAlert {
  alertId?: number | string;
  id?: number | string;
  [key: string]: any;
}

interface InventoryState {
  lowStockCount: number;
  outOfStockCount: number;
  inQuarantineCount: number;
  totalStockValue: number | null;
  totalProducts: number;
  pendingAdjustmentsCount: number;
  pendingReorderAlerts: ReorderAlert[];
  loading: boolean;
  refreshAll: () => Promise<void>;
  refreshAlerts: () => Promise<void>;
  refreshAdjustmentsBadge: () => Promise<void>;
  prependReorderAlert: (alert: ReorderAlert) => void;
  bumpPendingAdjustments: (delta?: number) => void;
}

// Inventory store keeps the small counters used by the sidebar and the
// dashboard up-to-date in real time. The cache of variant quantities itself
// lives in stockCacheService.
export const useInventoryStore = create<InventoryState>()((set, get) => ({
  lowStockCount: 0,
  outOfStockCount: 0,
  inQuarantineCount: 0,
  totalStockValue: null,
  totalProducts: 0,
  pendingAdjustmentsCount: 0,
  pendingReorderAlerts: [],
  loading: false,

  async refreshAll() {
    set({ loading: true });
    try {
      const [summary, adj, alerts] = await Promise.all([
        getStockSummary({ page: 1, limit: 1, includeTotals: 1 }).catch(() => null),
        listAdjustments({ status: 'pending', limit: 1 }).catch(() => null),
        listReorderAlerts('pending').catch(() => null),
      ]);

      if (summary?.meta?.totals) {
        const t = summary.meta.totals;
        set({
          totalProducts: t.totalProducts || 0,
          lowStockCount: t.lowStock || 0,
          outOfStockCount: t.outOfStock || 0,
          inQuarantineCount: t.inQuarantine || 0,
          totalStockValue: t.totalValueAtCost,
        });
      }
      if (adj?.meta) {
        set({ pendingAdjustmentsCount: adj.meta.pendingCount || 0 });
      }
      if (alerts) {
        set({ pendingReorderAlerts: alerts.data || [] });
      }
    } finally {
      set({ loading: false });
    }
  },

  async refreshAlerts() {
    try {
      const res = await listReorderAlerts('pending');
      set({ pendingReorderAlerts: res?.data || [] });
    } catch (_e) {
      // ignore
    }
  },

  async refreshAdjustmentsBadge() {
    try {
      const res = await listAdjustments({ status: 'pending', limit: 1 });
      set({ pendingAdjustmentsCount: res?.meta?.pendingCount || 0 });
    } catch (_e) {
      // ignore
    }
  },

  prependReorderAlert(alert) {
    const list = get().pendingReorderAlerts || [];
    if (list.some((a) => a.alertId === alert.alertId || a.id === alert.alertId))
      return;
    set({ pendingReorderAlerts: [alert, ...list] });
  },

  bumpPendingAdjustments(delta = 1) {
    set({ pendingAdjustmentsCount: Math.max(0, get().pendingAdjustmentsCount + delta) });
  },
}));
