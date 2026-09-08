import { create } from 'zustand';

interface PermissionModalPayload {
  action?: string;
  permission?: string | null;
  [key: string]: unknown;
}

export interface ErrorModalPayload {
  title?: string;
  message?: string;
  code?: string;
  details?: unknown;
  suggestions?: string[];
  showReportBug?: boolean;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}

interface UiErrorState {
  permissionModal: PermissionModalPayload | null;
  sessionModal: boolean;
  errorModal: ErrorModalPayload | null;
  bugReportPrefill: unknown;
  bugReportOpen: boolean;
  showPermissionDenied: (payload?: PermissionModalPayload | null) => void;
  hidePermissionDenied: () => void;
  showSessionExpired: () => void;
  hideSessionExpired: () => void;
  showErrorModal: (payload: ErrorModalPayload) => void;
  hideErrorModal: () => void;
  openBugReport: (prefill?: unknown) => void;
  closeBugReport: () => void;
}

export const useUiErrorStore = create<UiErrorState>()((set) => ({
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
