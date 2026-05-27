import { create } from 'zustand';

export const useUiErrorStore = create((set) => ({
  permissionModal: null,
  sessionModal: false,
  errorModal: null,
  bugReportPrefill: null,
  bugReportOpen: false,

  showPermissionDenied: (payload) =>
    set({
      permissionModal: payload || {
        action: 'perform this action',
        permission: null,
      },
    }),
  hidePermissionDenied: () => set({ permissionModal: null }),

  showSessionExpired: () => set({ sessionModal: true }),
  hideSessionExpired: () => set({ sessionModal: false }),

  showErrorModal: (payload) => set({ errorModal: payload }),
  hideErrorModal: () => set({ errorModal: null }),

  openBugReport: (prefill = null) =>
    set({ bugReportOpen: true, bugReportPrefill: prefill }),
  closeBugReport: () => set({ bugReportOpen: false, bugReportPrefill: null }),
}));
