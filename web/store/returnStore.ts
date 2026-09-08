import { create } from 'zustand';
import { getReturnRequestSummary } from '@/services/returnService';
import { getReturnOrderSummary } from '@/services/returnOrderService';

interface ReturnState {
  pendingCount: number;
  pendingNoInvoiceCount: number;
  approvedThisMonth: number;
  rejectedCount: number;
  ordersTotal: number;
  ordersThisMonth: number;
  ordersTotalValue: number;
  ordersTotalRefunded: number;
  refresh: () => Promise<void>;
  reset: () => void;
}

// Sidebar / dashboard counters for the returns module — pending requests, this
// month execution stats, etc. Refreshed on boot + on socket events.
export const useReturnStore = create<ReturnState>()((set) => ({
  pendingCount: 0,
  pendingNoInvoiceCount: 0,
  approvedThisMonth: 0,
  rejectedCount: 0,
  ordersTotal: 0,
  ordersThisMonth: 0,
  ordersTotalValue: 0,
  ordersTotalRefunded: 0,

  async refresh() {
    try {
      const [req, ord] = await Promise.all([
        getReturnRequestSummary(),
        getReturnOrderSummary(),
      ]);
      set({
        pendingCount: req?.pending_count || 0,
        pendingNoInvoiceCount: req?.pending_no_invoice || 0,
        approvedThisMonth: req?.approved_this_month || 0,
        rejectedCount: req?.rejected_count || 0,
        ordersTotal: ord?.total || 0,
        ordersThisMonth: ord?.thisMonth || 0,
        ordersTotalValue: Number(ord?.totalValue || 0),
        ordersTotalRefunded: Number(ord?.totalRefunded || 0),
      });
    } catch (_e) {
      // Permission-denied or network errors should not crash the layout.
    }
  },

  reset() {
    set({
      pendingCount: 0,
      pendingNoInvoiceCount: 0,
      approvedThisMonth: 0,
      rejectedCount: 0,
      ordersTotal: 0,
      ordersThisMonth: 0,
      ordersTotalValue: 0,
      ordersTotalRefunded: 0,
    });
  },
}));
