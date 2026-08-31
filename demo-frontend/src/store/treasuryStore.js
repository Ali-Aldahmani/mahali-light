import { create } from 'zustand';
import { getDrawerState } from '../services/cashDrawerService.js';
import { listBankAccounts } from '../services/bankAccountService.js';
import { getTreasurySummary } from '../services/treasuryService.js';

// Lightweight global treasury state used by the header widget, sidebar, and
// dashboard tiles. The full /treasury page maintains its own local state for
// the heavier overview snapshot, but it also calls `refresh()` after any
// mutation so the header always reflects the truth.
export const useTreasuryStore = create((set) => ({
  drawer: null,
  cashBalance: 0,
  drawerStatus: 'closed',
  drawerSessionId: null,
  banksTotal: 0,
  banks: [],
  netPosition: 0,
  totalAssets: 0,
  todayIn: 0,
  todayOut: 0,
  loading: false,
  lastUpdatedAt: null,

  async refresh() {
    set({ loading: true });
    try {
      const summary = await getTreasurySummary();
      set({
        drawer: summary?.cash || null,
        cashBalance: Number(summary?.cash?.balance || 0),
        drawerStatus: summary?.cash?.status || 'closed',
        drawerSessionId: summary?.cash?.sessionId || null,
        banksTotal: Number(summary?.banks?.total || 0),
        banks: summary?.banks?.accounts || [],
        netPosition: Number(summary?.netPosition || 0),
        totalAssets: Number(summary?.totalAssets || 0),
        todayIn: Number(summary?.today?.moneyIn || 0),
        todayOut: Number(summary?.today?.moneyOut || 0),
        lastUpdatedAt: new Date().toISOString(),
        loading: false,
      });
    } catch (_err) {
      // Lower-privileged users (e.g. Cashier) only have cash.view — fall back
      // to the lighter drawer-state endpoint so the header widget still works.
      try {
        const drawer = await getDrawerState();
        set({
          drawer,
          cashBalance: Number(drawer?.currentBalance || 0),
          drawerStatus: drawer?.status || 'closed',
          drawerSessionId: drawer?.session?.id || null,
        });
      } catch (_e2) {
        // Permission-denied → reset silently.
      }
      set({ loading: false });
    }
  },

  async refreshDrawer() {
    try {
      const drawer = await getDrawerState();
      set({
        drawer,
        cashBalance: Number(drawer?.currentBalance || 0),
        drawerStatus: drawer?.status || 'closed',
        drawerSessionId: drawer?.session?.id || null,
      });
    } catch (_e) {
      // ignore
    }
  },

  async refreshBanks() {
    try {
      const accounts = await listBankAccounts();
      const total = accounts.reduce(
        (acc, a) => acc + Number(a.currentBalance || 0),
        0,
      );
      set({
        banks: accounts.map((a) => ({
          id: a.id,
          bankName: a.bankName,
          accountName: a.accountName,
          currentBalance: Number(a.currentBalance || 0),
          isDefault: a.isDefault,
        })),
        banksTotal: Math.round(total * 100) / 100,
      });
    } catch (_e) {
      // ignore
    }
  },

  applyCashEvent(payload) {
    if (payload?.newBalance == null) return;
    set({ cashBalance: Number(payload.newBalance) });
  },

  applyBankEvent(payload) {
    if (!payload?.bankAccountId) return;
    set((state) => ({
      banks: state.banks.map((b) =>
        b.id === payload.bankAccountId
          ? { ...b, currentBalance: Number(payload.newBalance) }
          : b,
      ),
      banksTotal: state.banks.reduce(
        (acc, b) =>
          acc +
          (b.id === payload.bankAccountId
            ? Number(payload.newBalance)
            : Number(b.currentBalance || 0)),
        0,
      ),
    }));
  },

  reset() {
    set({
      drawer: null,
      cashBalance: 0,
      drawerStatus: 'closed',
      drawerSessionId: null,
      banksTotal: 0,
      banks: [],
      netPosition: 0,
      totalAssets: 0,
      todayIn: 0,
      todayOut: 0,
    });
  },
}));
