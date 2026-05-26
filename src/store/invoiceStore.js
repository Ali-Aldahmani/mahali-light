import { create } from 'zustand';
import { listEditRequests } from '../services/invoiceEditRequestService.js';
import { listInvoices } from '../services/invoiceService.js';

// Lightweight global counters for invoice-related sidebar badges and
// dashboard tiles. Page-level data is loaded by individual pages; this store
// just keeps the cross-page counters in sync.
export const useInvoiceStore = create((set) => ({
  pendingEditRequests: 0,
  revenueToday: 0,
  invoicesToday: 0,
  outstanding: 0,
  loading: false,

  async refreshEditRequestsCount() {
    try {
      const { meta } = await listEditRequests({ status: 'pending' });
      set({ pendingEditRequests: meta?.totals?.pending || 0 });
    } catch (_e) {
      // Cashiers without invoice.edit_approve will 403 — ignore.
    }
  },

  async refreshSummary() {
    set({ loading: true });
    try {
      const { meta } = await listInvoices({ page: 1, limit: 1 });
      const t = meta?.totals || {};
      set({
        revenueToday: Number(t.revenueToday || 0),
        invoicesToday: Number(t.invoicesToday || 0),
        outstanding: Number(t.outstanding || 0),
      });
    } catch (_e) {
      // ignore
    } finally {
      set({ loading: false });
    }
  },
}));
