import { create } from 'zustand';

interface PresenceUser {
  userId: string | number;
  pcIdentifier?: string;
  status?: 'online' | 'idle' | string;
  [key: string]: any;
}

interface PresenceState {
  onlineUsers: PresenceUser[];
  setOnlineUsers: (users: PresenceUser[]) => void;
  upsertUser: (entry: PresenceUser) => void;
  removeUser: (params: { userId: string | number; pcIdentifier?: string }) => void;
  setIdle: (params: { userId: string | number }) => void;
}

export const usePresenceStore = create<PresenceState>()((set, get) => ({
  onlineUsers: [],

  setOnlineUsers: (users) => set({ onlineUsers: users }),

  // Merges into the existing entry, so an event that lacks a field (the login
  // event carries no employee name) doesn't erase what an earlier one set.
  upsertUser: (entry) => {
    const same = (u: PresenceUser) => u.userId === entry.userId && u.pcIdentifier === entry.pcIdentifier;
    const existing = get().onlineUsers.find(same);
    const defined = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined && v !== null));
    const list = get().onlineUsers.filter((u) => !same(u));
    set({ onlineUsers: [...list, { ...existing, ...defined, userId: entry.userId, status: entry.status || 'online' }] });
  },

  removeUser: ({ userId, pcIdentifier }) => {
    set({
      onlineUsers: get().onlineUsers.filter(
        (u) => !(u.userId === userId && (!pcIdentifier || u.pcIdentifier === pcIdentifier)),
      ),
    });
  },

  setIdle: ({ userId }) => {
    set({
      onlineUsers: get().onlineUsers.map((u) =>
        u.userId === userId ? { ...u, status: 'idle' } : u,
      ),
    });
  },
}));
