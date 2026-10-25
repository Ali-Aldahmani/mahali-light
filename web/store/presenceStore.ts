import { create } from 'zustand';
import { listOnline } from '@/services/presenceService';

// Who is online, one entry per user (server: services/presenceService.js).
//
// The server publishes `presence_update { userId, entry }` with that user's
// whole current entry, or entry = null when they have no live session left.
// A snapshot (GET /presence) is read on every socket (re)connect, because
// events sent while this PC was disconnected are never replayed.

export interface PresenceUser {
  userId: string | number;
  sessionId?: string;
  username?: string;
  employeeName?: string | null;
  role?: string | null;
  pcIdentifier?: string;
  status?: 'online' | 'idle' | string;
  lastActivityAt?: string;
  [key: string]: any;
}

interface PresenceState {
  onlineUsers: PresenceUser[];
  // Bumped by every live update, so a snapshot that was requested before an
  // update and answered after it is known to be stale and read again.
  revision: number;
  setOnlineUsers: (users: PresenceUser[]) => void;
  applyUpdate: (update: { userId: string | number; entry: PresenceUser | null }) => void;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>()((set, get) => ({
  onlineUsers: [],
  revision: 0,

  setOnlineUsers: (users) => set({ onlineUsers: users }),

  applyUpdate: ({ userId, entry }) => {
    const others = get().onlineUsers.filter((u) => u.userId !== userId);
    set({
      onlineUsers: entry ? [{ ...entry, userId }, ...others] : others,
      revision: get().revision + 1,
    });
  },

  refresh: async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = get().revision;
      const rows = await listOnline();
      if (get().revision === before) {
        set({ onlineUsers: rows || [] });
        return;
      }
    }
  },

  clear: () => set({ onlineUsers: [], revision: get().revision + 1 }),
}));
