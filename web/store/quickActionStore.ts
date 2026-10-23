import { create } from 'zustand';

/** App-wide panels that shortcuts and the command palette can open from any page. */
interface QuickActionState {
  customerFormOpen: boolean;
  shortcutsOpen: boolean;
  settingsOpen: boolean;
  openCustomerForm: () => void;
  closeCustomerForm: () => void;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useQuickActionStore = create<QuickActionState>()((set) => ({
  customerFormOpen: false,
  shortcutsOpen: false,
  settingsOpen: false,
  openCustomerForm: () => set({ customerFormOpen: true }),
  closeCustomerForm: () => set({ customerFormOpen: false }),
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
