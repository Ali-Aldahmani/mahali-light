import { create } from 'zustand';
import {
  getWarrantySummary,
  listWarranties,
} from '../services/warrantyService.js';
import { getClaimsSummary } from '../services/warrantyClaimService.js';

// Sidebar / dashboard counters for warranties + claims. Refreshed on app boot
// and whenever a Socket.io event signals a change.
export const useWarrantyStore = create((set, get) => ({
  activeCount: 0,
  expiringSoonCount: 0,
  expiringThisMonthCount: 0,
  expiredThisYearCount: 0,
  claimedCount: 0,
  openClaimsCount: 0,
  inProgressClaimsCount: 0,
  resolvedThisMonthClaims: 0,
  rejectedClaimsCount: 0,
  supplierPendingClaims: 0,
  expiringWarranties: [],

  async refresh() {
    try {
      const [w, c] = await Promise.all([
        getWarrantySummary(),
        getClaimsSummary(),
      ]);
      set({
        activeCount: w?.active_count || 0,
        expiringSoonCount: w?.expiring_soon_count || 0,
        expiringThisMonthCount: w?.expiring_this_month_count || 0,
        expiredThisYearCount: w?.expired_this_year_count || 0,
        claimedCount: w?.claimed_count || 0,
        openClaimsCount: c?.open_count || 0,
        inProgressClaimsCount: c?.in_progress_count || 0,
        resolvedThisMonthClaims: c?.resolved_this_month || 0,
        rejectedClaimsCount: c?.rejected_count || 0,
        supplierPendingClaims: c?.supplier_pending || 0,
      });
    } catch (_e) {
      // Permission-denied or network errors should not crash the layout.
    }
  },

  async refreshExpiringList(limit = 10) {
    try {
      const { data } = await listWarranties({ expiring_soon: 'true', limit });
      set({ expiringWarranties: data || [] });
    } catch (_e) {
      // ignore
    }
  },

  reset() {
    set({
      activeCount: 0,
      expiringSoonCount: 0,
      expiringThisMonthCount: 0,
      expiredThisYearCount: 0,
      claimedCount: 0,
      openClaimsCount: 0,
      inProgressClaimsCount: 0,
      resolvedThisMonthClaims: 0,
      rejectedClaimsCount: 0,
      supplierPendingClaims: 0,
      expiringWarranties: [],
    });
  },
}));
