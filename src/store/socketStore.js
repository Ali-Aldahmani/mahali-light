import { create } from 'zustand';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config.js';
import { useAuthStore } from './authStore.js';
import { usePresenceStore } from './presenceStore.js';
import { toast } from './toastStore.js';

let heartbeatTimer = null;

// Subscribers interested in product cache updates can register a callback.
const productListeners = new Set();
export function onProductUpdate(cb) {
  productListeners.add(cb);
  return () => productListeners.delete(cb);
}
function emitProductUpdate(payload) {
  for (const cb of productListeners) {
    try {
      cb(payload);
    } catch (_e) {
      // ignore listener errors
    }
  }
}

export const useSocketStore = create((set, get) => ({
  socket: null,
  isConnected: false,

  connect: () => {
    if (get().socket) return get().socket;
    const token = useAuthStore.getState().token;
    if (!token) return null;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
    });

    socket.on('connect', () => set({ isConnected: true }));
    socket.on('disconnect', () => set({ isConnected: false }));

    socket.on('connect_error', (err) => {
      if (err.message === 'AUTH_SESSION_EXPIRED' || err.message === 'AUTH_TOKEN_INVALID') {
        toast.error('Session expired. Please sign in again.');
        useAuthStore.getState().logoutLocal();
      }
    });

    socket.on('user_online', (payload) => {
      usePresenceStore.getState().upsertUser(payload);
    });
    socket.on('user_offline', (payload) => {
      usePresenceStore.getState().removeUser(payload);
    });
    socket.on('user_idle', (payload) => {
      usePresenceStore.getState().setIdle(payload);
    });
    socket.on('force_logout', (payload) => {
      toast.error(`You were signed out: ${payload?.reason || 'forced by admin'}`);
      useAuthStore.getState().logoutLocal();
    });

    socket.on('product_updated', (payload) => {
      emitProductUpdate(payload);
    });

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket.connected) socket.emit('heartbeat');
    }, 30000);

    set({ socket });
    return socket;
  },

  disconnect: () => {
    const socket = get().socket;
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    set({ socket: null, isConnected: false });
  },
}));
