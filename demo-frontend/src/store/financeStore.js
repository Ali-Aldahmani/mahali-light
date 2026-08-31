import { create } from 'zustand';
import { getFinanceDashboard } from '../services/financeService.js';

// Holds the dashboard widget snapshot so multiple consumers (the main app
// dashboard, the finance landing tab) share the same data without
// re-fetching. Heavier per-page state (P&L, Balance Sheet, etc.) lives in
// each page's local component state.
export const useFinanceStore = create((set, get) => ({
  snapshot: null,
  lastFetchedAt: null,
  loading: false,
  lastError: null,

  refreshSnapshot: async (force = false) => {
    const last = get().lastFetchedAt;
    const stale = !last || Date.now() - last > 60_000;
    if (!force && !stale && get().snapshot) return get().snapshot;
    try {
      set({ loading: true, lastError: null });
      const snapshot = await getFinanceDashboard();
      set({ snapshot, lastFetchedAt: Date.now() });
      return snapshot;
    } catch (err) {
      set({ lastError: err?.message || 'Failed to load finance snapshot.' });
      throw err;
    } finally {
      set({ loading: false });
    }
  },
}));
