import { create } from 'zustand';

export const usePresenceStore = create((set, get) => ({
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
