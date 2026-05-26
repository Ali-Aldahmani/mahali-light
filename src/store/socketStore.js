import { create } from 'zustand';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config.js';
import { useAuthStore } from './authStore.js';
import { usePresenceStore } from './presenceStore.js';
import { toast } from './toastStore.js';
import { handleStockUpdate, syncOnReconnect } from '../services/stockCacheService.js';

let heartbeatTimer = null;

// Generic subscriber bus for stock/product realtime events. Pages use this to
// re-fetch their data without each having to wire onto the socket directly.
function makeBus() {
  const listeners = new Set();
  return {
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(payload) {
      for (const cb of listeners) {
        try {
          cb(payload);
        } catch (_e) {
          // ignore listener errors
        }
      }
    },
  };
}

const productBus = makeBus();
const stockBus = makeBus();
const reorderBus = makeBus();
const adjustmentBus = makeBus();
const countBus = makeBus();
const poBus = makeBus();
const supplierReturnBus = makeBus();

export const onProductUpdate = (cb) => productBus.on(cb);
export const onStockUpdate = (cb) => stockBus.on(cb);
export const onReorderAlert = (cb) => reorderBus.on(cb);
export const onAdjustmentEvent = (cb) => adjustmentBus.on(cb);
export const onCountEvent = (cb) => countBus.on(cb);
export const onPurchaseOrderEvent = (cb) => poBus.on(cb);
export const onSupplierReturnEvent = (cb) => supplierReturnBus.on(cb);

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

    let firstConnect = true;
    socket.on('connect', () => {
      const wasConnected = get().isConnected;
      set({ isConnected: true });
      // First connect is handled by initStockCache() in AppLayout. Re-sync
      // only on subsequent connections (i.e. socket reconnects).
      if (!firstConnect) {
        syncOnReconnect().catch(() => {});
      }
      firstConnect = false;
      if (wasConnected) {
        // Notify listeners they may need to refresh after a reconnect.
        stockBus.emit({ reconnected: true });
      }
    });
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
      productBus.emit(payload);
    });

    socket.on('stock_updated', (payload) => {
      handleStockUpdate(payload);
      stockBus.emit(payload);
    });

    socket.on('reorder_alert_created', (payload) => {
      reorderBus.emit(payload);
      toast.warning(
        `Low stock: ${payload.productName} (${payload.currentStock} ${payload.unitLabel || ''})`,
      );
    });

    socket.on('adjustment_request_created', (payload) => {
      adjustmentBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `Adjustment request from ${payload.requestedByUsername || 'a user'}: ${payload.productName}`,
      );
    });

    socket.on('adjustment_request_reviewed', (payload) => {
      adjustmentBus.emit({ ...payload, kind: 'reviewed' });
      if (payload.status === 'approved') {
        toast.success(
          `Your adjustment request was approved by ${payload.reviewedByUsername || 'a manager'}.`,
        );
      } else if (payload.status === 'rejected') {
        toast.error(
          `Your adjustment request was rejected${payload.rejectionReason ? ': ' + payload.rejectionReason : '.'}`,
        );
      }
    });

    socket.on('stock_count_submitted', (payload) => {
      countBus.emit({ ...payload, kind: 'submitted' });
      toast.info(
        `Stock count submitted (${payload.discrepancyCount} discrepancies)`,
      );
    });

    socket.on('stock_count_reviewed', (payload) => {
      countBus.emit({ ...payload, kind: 'reviewed' });
      if (payload.status === 'approved') {
        toast.success('Your stock count was approved.');
      } else if (payload.status === 'rejected') {
        toast.error(
          `Your stock count was rejected${payload.rejectionReason ? ': ' + payload.rejectionReason : '.'}`,
        );
      }
    });

    socket.on('po_created', (payload) => {
      poBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `New PO ${payload.poNumber || ''} from ${payload.createdByUsername || 'a user'}`,
      );
    });

    socket.on('po_received', (payload) => {
      poBus.emit({ ...payload, kind: 'received' });
      toast.success(
        `PO ${payload.poNumber || ''} ${payload.status === 'received' ? 'fully' : 'partially'} received.`,
      );
    });

    socket.on('po_payment_added', (payload) => {
      poBus.emit({ ...payload, kind: 'payment_added' });
      toast.info(
        `Payment recorded on PO ${payload.poNumber || ''}${
          payload.paymentStatus === 'paid' ? ' (paid in full)' : ''
        }.`,
      );
    });

    socket.on('po_overdue', (payload) => {
      poBus.emit({ ...payload, kind: 'overdue' });
      if (payload?.count > 0) {
        toast.warning(
          `${payload.count} purchase order${payload.count === 1 ? '' : 's'} past due.`,
        );
      }
    });

    socket.on('supplier_return_created', (payload) => {
      supplierReturnBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `Supplier return ${payload.returnNumber || ''} created.`,
      );
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
