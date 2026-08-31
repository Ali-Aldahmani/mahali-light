import { create } from 'zustand';
import { getUpcomingBills } from '../services/billService.js';
import { getExpenseSummary } from '../services/expenseService.js';

// Lightweight global store for the sidebar badge (overdue + due_today count)
// and the dashboard widget. Detail pages do their own fetching.
export const useBillStore = create((set, get) => ({
  upcoming: null,
  expenseSummary: null,
  loading: false,
  lastError: null,

  refreshUpcoming: async () => {
    try {
      set({ loading: true, lastError: null });
      const upcoming = await getUpcomingBills();
      set({ upcoming });
    } catch (err) {
      set({ lastError: err?.message || 'Failed to load upcoming bills.' });
    } finally {
      set({ loading: false });
    }
  },

  refreshExpenseSummary: async (params) => {
    try {
      const summary = await getExpenseSummary(params);
      set({ expenseSummary: summary });
    } catch (_e) {
      // best-effort
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshUpcoming(), get().refreshExpenseSummary()]);
  },

  // Returns the count of overdue + due_today bills, used by the sidebar badge.
  attentionCount: () => {
    const buckets = get().upcoming?.buckets;
    if (!buckets) return 0;
    return (buckets.overdue?.length || 0) + (buckets.dueToday?.length || 0);
  },
}));
