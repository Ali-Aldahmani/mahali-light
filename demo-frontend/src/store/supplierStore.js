import { create } from 'zustand';
import { listPurchaseOrders } from '../services/purchaseOrderService.js';

// Supplier store keeps the sidebar/dashboard summary counters in sync. Heavy
// data (lists, supplier profiles) is fetched per-page on demand.
export const useSupplierStore = create((set) => ({
  totalPos: 0,
  pendingPaymentCount: 0,
  overdueCount: 0,
  overdueAmount: null,
  thisMonthSpent: null,
  loading: false,

  async refreshSummary() {
    set({ loading: true });
    try {
      const { meta } = await listPurchaseOrders({ page: 1, limit: 1 });
      const t = meta?.totals || {};
      set({
        totalPos: t.totalPos || 0,
        pendingPaymentCount: t.pendingPayment || 0,
        overdueCount: t.overdueCount || 0,
        overdueAmount: t.overdueAmount ?? null,
        thisMonthSpent: t.thisMonthSpent ?? null,
      });
    } catch (_e) {
      // ignore
    } finally {
      set({ loading: false });
    }
  },
}));
