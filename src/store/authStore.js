import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const STORAGE_KEY = 'mahali-light.auth';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      permissions: [],

      isAuthenticated: () => Boolean(get().token && get().user),

      hasPermission: (key) => {
        if (!key) return true;
        return (get().permissions || []).includes(key);
      },

      hasAnyPermission: (keys = []) => {
        const owned = new Set(get().permissions || []);
        return keys.some((k) => owned.has(k));
      },

      setSession: ({ token, user }) => {
        set({
          token,
          user,
          permissions: user?.permissions || [],
        });
      },

      setUser: (user) => set({ user, permissions: user?.permissions || [] }),

      logoutLocal: () => set({ user: null, token: null, permissions: [] }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        permissions: state.permissions,
      }),
    },
  ),
);
