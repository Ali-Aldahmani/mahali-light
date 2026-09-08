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

  upsertUser: (entry) => {
    const list = get().onlineUsers.filter(
      (u) => !(u.userId === entry.userId && u.pcIdentifier === entry.pcIdentifier),
    );
    set({ onlineUsers: [...list, { ...entry, status: entry.status || 'online' }] });
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
