import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const STORAGE_KEY = 'mahali-light.auth';

// Clear any stale token that may have been persisted to localStorage by an
// older build.  Without this, upgrading from localStorage→sessionStorage would
// leave a ghost entry that is never read but also never removed.
try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }

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
      // sessionStorage is cleared automatically when the Electron window (or
      // browser tab) closes, so the user must sign in again on every launch.
      // localStorage would survive app restarts, which is a security risk for
      // a shared POS terminal where different employees use the same machine.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        permissions: state.permissions,
      }),
    },
  ),
);
