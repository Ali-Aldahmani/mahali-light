import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthState } from '@/types';

const STORAGE_KEY = 'mahali-light.auth';

// Clear any stale token that may have been persisted to localStorage by an
// older build.  Without this, upgrading from localStorage→sessionStorage would
// leave a ghost entry that is never read but also never removed.
try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      permissions: [],
      sessionKey: null,
      idleSignOutMinutes: 15,

      isAuthenticated: () => Boolean(get().token && get().user),

      hasPermission: (key) => {
        if (!key) return true;
        return (get().permissions || []).includes(key);
      },

      hasAnyPermission: (keys = []) => {
        const owned = new Set(get().permissions || []);
        return keys.some((k) => owned.has(k));
      },

      setSession: ({ token, user, idleSignOutMinutes }) => {
        set({
          token,
          user,
          permissions: user?.permissions || [],
          sessionKey: `${user?.id || 'user'}:${Date.now()}`,
          idleSignOutMinutes: Number.isFinite(idleSignOutMinutes) ? Number(idleSignOutMinutes) : 15,
        });
      },

      setToken: (token) => {
        set({ token });
        shareToken(get().sessionKey, token);
      },

      setUser: (user) => set({ user, permissions: user?.permissions || [] }),

      logoutLocal: () => set({ user: null, token: null, permissions: [], sessionKey: null }),
    }),
    {
      name: STORAGE_KEY,
      // sessionStorage is cleared automatically when the Electron window (or
      // browser tab) closes, so the user must sign in again on every launch.
      // localStorage would survive app restarts, which is a security risk for
      // a shared POS terminal where different employees use the same machine.
      storage: createJSONStorage(() => sessionStorage),
      // A session saved by an older build has no sessionKey; give it one so
      // its screens still connect after the update.
      merge: (persisted: any, current) => {
        const merged = { ...current, ...(persisted || {}) };
        if (merged.token && !merged.sessionKey) merged.sessionKey = `${merged.user?.id || 'user'}:restored`;
        return merged;
      },
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        permissions: state.permissions,
        sessionKey: state.sessionKey,
        idleSignOutMinutes: state.idleSignOutMinutes,
      }),
    },
  ),
);

// A duplicated tab shares the session but keeps its own copy of the token.
// Each refresh replaces the token, so the other tab's copy stopped working a
// minute later and it got signed out (review 5 Nov). Tabs on the same session
// now pass the new token to each other.
let tokenChannel: BroadcastChannel | null = null;
function getTokenChannel(): BroadcastChannel | null {
  if (tokenChannel || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return tokenChannel;
  tokenChannel = new BroadcastChannel('mahali-auth-token');
  tokenChannel.onmessage = (event) => {
    const { sessionKey, token } = event.data || {};
    const state = useAuthStore.getState();
    if (token && sessionKey && sessionKey === state.sessionKey && token !== state.token) {
      useAuthStore.setState({ token });
    }
  };
  return tokenChannel;
}

function shareToken(sessionKey: string | null | undefined, token: string | null) {
  if (!sessionKey || !token) return;
  try {
    getTokenChannel()?.postMessage({ sessionKey, token });
  } catch (_e) {
    // Sharing is a convenience; each tab still refreshes on its own.
  }
}

// Start listening as soon as the store loads, not only after a refresh here.
getTokenChannel();
