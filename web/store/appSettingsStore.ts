import { create } from 'zustand';
import * as api from '@/services/appSettingsService';

interface AppSettingsState {
  settings: any;
  publicSettings: any;
  loading: boolean;
  fetch: () => Promise<any>;
  fetchPublic: () => Promise<any>;
  save: (patch: any) => Promise<any>;
  isSetupComplete: () => boolean;
}

export const useAppSettingsStore = create<AppSettingsState>()((set, get) => ({
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
