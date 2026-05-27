import { create } from 'zustand';
import * as api from '../services/appSettingsService.js';

export const useAppSettingsStore = create((set, get) => ({
  settings: null,
  publicSettings: null,
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const s = await api.getAppSettings();
      set({ settings: s });
      return s;
    } finally {
      set({ loading: false });
    }
  },

  fetchPublic: async () => {
    const s = await api.getPublicAppSettings();
    set({ publicSettings: s });
    return s;
  },

  save: async (patch) => {
    const s = await api.updateAppSettings(patch);
    set({ settings: s });
    return s;
  },

  isSetupComplete: () => Boolean(get().publicSettings?.setup_completed ?? get().settings?.setup_completed),
}));
