import { create } from 'zustand';
import { listCustomers } from '../services/customerService.js';

// Tracks the small counters used by the sidebar / dashboard for customers.
// Heavy data is fetched on-page; this store just keeps badges and headline
// numbers in sync.
export const useCustomerStore = create((set) => ({
  totalCustomers: 0,
  customersWithBalance: 0,
  totalOutstanding: null,
  newThisMonth: 0,
  loading: false,

  async refreshSummary() {
    set({ loading: true });
    try {
      const { meta } = await listCustomers({ page: 1, limit: 1 });
      const t = meta?.totals || {};
      set({
        totalCustomers: t.totalCustomers || 0,
        customersWithBalance: t.customersWithBalance || 0,
        totalOutstanding: t.totalOutstanding ?? null,
        newThisMonth: t.newThisMonth || 0,
      });
    } catch (_e) {
      // ignore
    } finally {
      set({ loading: false });
    }
  },
}));
