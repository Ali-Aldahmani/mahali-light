import { create } from 'zustand';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config.js';
import { useAuthStore } from './authStore.js';
import { usePresenceStore } from './presenceStore.js';
import { toast } from './toastStore.js';
import { handleStockUpdate, syncOnReconnect } from '../services/stockCacheService.js';
import { useNotificationStore } from './notificationStore.js';
import { useBackupStore } from './backupStore.js';

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
const customerBus = makeBus();
const invoiceBus = makeBus();
const invoiceEditRequestBus = makeBus();
const pdfBus = makeBus();
const printBus = makeBus();
const warrantyBus = makeBus();
const warrantyClaimBus = makeBus();
const returnBus = makeBus();
const treasuryBus = makeBus();
const attendanceBus = makeBus();
const leaveBus = makeBus();
const correctionBus = makeBus();
const holidayBus = makeBus();
const billBus = makeBus();
const expenseBus = makeBus();

export const onProductUpdate = (cb) => productBus.on(cb);
export const onStockUpdate = (cb) => stockBus.on(cb);
export const onReorderAlert = (cb) => reorderBus.on(cb);
export const onAdjustmentEvent = (cb) => adjustmentBus.on(cb);
export const onCountEvent = (cb) => countBus.on(cb);
export const onPurchaseOrderEvent = (cb) => poBus.on(cb);
export const onSupplierReturnEvent = (cb) => supplierReturnBus.on(cb);
export const onCustomerBalanceUpdate = (cb) => customerBus.on(cb);
export const onInvoiceEvent = (cb) => invoiceBus.on(cb);
export const onInvoiceEditRequestEvent = (cb) => invoiceEditRequestBus.on(cb);
export const onPdfReady = (cb) => pdfBus.on(cb);
export const onPrintRequest = (cb) => printBus.on(cb);
export const onWarrantyEvent = (cb) => warrantyBus.on(cb);
export const onWarrantyClaimEvent = (cb) => warrantyClaimBus.on(cb);
export const onReturnEvent = (cb) => returnBus.on(cb);
export const onTreasuryEvent = (cb) => treasuryBus.on(cb);
export const onAttendanceEvent = (cb) => attendanceBus.on(cb);
export const onLeaveEvent = (cb) => leaveBus.on(cb);
export const onCorrectionEvent = (cb) => correctionBus.on(cb);
export const onHolidayEvent = (cb) => holidayBus.on(cb);
export const onBillEvent = (cb) => billBus.on(cb);
export const onExpenseEvent = (cb) => expenseBus.on(cb);

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

    socket.on('invoice_confirmed', (payload) => {
      invoiceBus.emit({ ...payload, kind: 'confirmed' });
    });

    socket.on('invoice_cancelled', (payload) => {
      invoiceBus.emit({ ...payload, kind: 'cancelled' });
      toast.warning(
        `Invoice ${payload.invoiceNumber || ''} cancelled.`,
      );
    });

    socket.on('edit_request_created', (payload) => {
      invoiceEditRequestBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `Edit request from ${payload.requestedByUsername || 'cashier'} on invoice ${payload.invoiceNumber || ''}.`,
      );
    });

    socket.on('edit_request_reviewed', (payload) => {
      invoiceEditRequestBus.emit({ ...payload, kind: 'reviewed' });
      // Only show toast to the requesting cashier — best-effort by matching
      // the current user. Manager-side feedback comes from their own UI.
      const me = useAuthStore.getState().user?.id;
      if (payload.requestedBy && me && payload.requestedBy === me) {
        if (payload.status === 'approved') {
          toast.success('Your invoice edit request was approved.');
        } else if (payload.status === 'rejected') {
          toast.error(
            `Your invoice edit request was rejected${
              payload.reason ? ': ' + payload.reason : '.'
            }`,
          );
        }
      }
    });

    socket.on('warranty_created', (payload) => {
      warrantyBus.emit({ ...payload, kind: 'created' });
    });
    socket.on('warranty_created_batch', (payload) => {
      warrantyBus.emit({ ...payload, kind: 'batch_created' });
    });
    socket.on('warranty_voided', (payload) => {
      warrantyBus.emit({ ...payload, kind: 'voided' });
    });
    socket.on('warranty_voided_batch', (payload) => {
      warrantyBus.emit({ ...payload, kind: 'batch_voided' });
    });
    socket.on('warranty_expired_batch', (payload) => {
      warrantyBus.emit({ ...payload, kind: 'batch_expired' });
    });
    socket.on('warranty_expiring_soon', (payload) => {
      warrantyBus.emit({ ...payload, kind: 'expiring_soon' });
      if (payload?.count > 0) {
        toast.warning(
          `${payload.count} warrantie${payload.count === 1 ? '' : 's'} expiring in the next ${payload.withinDays || 30} days.`,
        );
      }
    });

    socket.on('warranty_claim_created', (payload) => {
      warrantyClaimBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `New warranty claim ${payload.claimNumber || ''}${payload.productName ? ` on ${payload.productName}` : ''}.`,
      );
    });
    socket.on('warranty_claim_resolved', (payload) => {
      warrantyClaimBus.emit({ ...payload, kind: 'resolved' });
    });
    socket.on('warranty_claim_updated', (payload) => {
      warrantyClaimBus.emit({ ...payload, kind: 'updated' });
    });

    socket.on('return_request_created', (payload) => {
      returnBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `New return request ${payload.requestNumber || ''}${
          payload.isNoInvoice ? ' (no-invoice — needs scrutiny)' : ''
        }.`,
      );
    });
    socket.on('return_request_reviewed', (payload) => {
      returnBus.emit({ ...payload, kind: 'reviewed' });
      const me = useAuthStore.getState().user?.id;
      if (payload.status === 'approved') {
        toast.success('Your return request was approved.');
      } else if (payload.status === 'rejected' && me) {
        toast.error(
          `Your return request was rejected${
            payload.rejectionReason ? ': ' + payload.rejectionReason : '.'
          }`,
        );
      } else if (payload.status === 'cancelled') {
        toast.info('Return request cancelled.');
      }
    });
    socket.on('return_executed', (payload) => {
      returnBus.emit({ ...payload, kind: 'executed' });
    });

    socket.on('invoice_pdf_pending', (payload) => {
      pdfBus.emit({ ...payload, kind: 'pending' });
    });
    socket.on('invoice_pdf_ready', (payload) => {
      pdfBus.emit({ ...payload, kind: 'ready' });
    });
    socket.on('print_receipt_requested', (payload) => {
      printBus.emit({ ...payload, kind: 'receipt' });
    });

    socket.on('cash_balance_updated', (payload) => {
      treasuryBus.emit({ ...payload, kind: 'cash_balance' });
    });
    socket.on('bank_balance_updated', (payload) => {
      treasuryBus.emit({ ...payload, kind: 'bank_balance' });
    });
    socket.on('drawer_opened', (payload) => {
      treasuryBus.emit({ ...payload, kind: 'drawer_opened' });
      toast.success(
        `Cash drawer opened (AED ${Number(payload.openingBalance || 0).toFixed(2)}).`,
      );
    });
    socket.on('drawer_closed', (payload) => {
      treasuryBus.emit({ ...payload, kind: 'drawer_closed' });
      const disc = Number(payload.discrepancy || 0);
      if (Math.abs(disc) < 0.01) {
        toast.success('Cash drawer closed (no discrepancy).');
      } else {
        toast.warning(
          `Drawer closed with discrepancy AED ${disc.toFixed(2)}.`,
        );
      }
    });

    socket.on('customer_balance_updated', (payload) => {
      customerBus.emit(payload);
      if (payload.reversed) {
        toast.warning(
          `Customer payment of AED ${Math.abs(payload.deltaAmount || 0).toFixed(
            2,
          )} reversed for ${payload.customerName || 'customer'}.`,
        );
      } else if (payload.deltaAmount < 0) {
        toast.success(
          `Collected AED ${Math.abs(payload.deltaAmount).toFixed(2)} from ${payload.customerName || 'customer'}.`,
        );
      }
    });

    // Phase 11 — attendance + leaves + corrections + holidays.
    socket.on('attendance_checked_in', (payload) => {
      attendanceBus.emit({ ...payload, kind: 'checked_in' });
    });
    socket.on('attendance_checked_out', (payload) => {
      attendanceBus.emit({ ...payload, kind: 'checked_out' });
    });
    socket.on('attendance_day_finalized', (payload) => {
      attendanceBus.emit({ ...payload, kind: 'day_finalized' });
      toast.info(
        `Day finalized — ${payload.markedAbsent || 0} absentee(s), ${payload.autoClosed || 0} auto-closed.`,
      );
    });

    socket.on('leave_request_created', (payload) => {
      leaveBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `Leave request from ${payload.employeeName || 'employee'} (${payload.leaveType}, ${payload.totalDays}d).`,
      );
    });
    socket.on('leave_request_reviewed', (payload) => {
      leaveBus.emit({ ...payload, kind: 'reviewed' });
      const myEmployeeId = useAuthStore.getState().user?.employeeId;
      if (myEmployeeId && payload.employeeId === myEmployeeId) {
        if (payload.status === 'approved') {
          toast.success('Your leave request was approved.');
        } else if (payload.status === 'rejected') {
          toast.error(
            `Your leave request was rejected${
              payload.rejectionReason ? ': ' + payload.rejectionReason : '.'
            }`,
          );
        } else if (payload.status === 'cancelled') {
          toast.info('Your leave request was cancelled.');
        }
      }
    });

    socket.on('correction_request_created', (payload) => {
      correctionBus.emit({ ...payload, kind: 'created' });
      toast.info(
        `Correction request from ${payload.employeeName || 'employee'} (${payload.date}).`,
      );
    });
    socket.on('correction_request_reviewed', (payload) => {
      correctionBus.emit({ ...payload, kind: 'reviewed' });
      const myEmployeeId = useAuthStore.getState().user?.employeeId;
      if (myEmployeeId && payload.employeeId === myEmployeeId) {
        if (payload.status === 'approved') {
          toast.success('Your attendance correction was approved.');
        } else if (payload.status === 'rejected') {
          toast.error(
            `Your attendance correction was rejected${
              payload.rejectionReason ? ': ' + payload.rejectionReason : '.'
            }`,
          );
        }
      }
    });

    socket.on('holiday_added', (payload) => {
      holidayBus.emit({ ...payload, kind: 'added' });
    });
    socket.on('holiday_removed', (payload) => {
      holidayBus.emit({ ...payload, kind: 'removed' });
    });

    // Phase 12 — bills & expenses.
    socket.on('bill_due_reminder', (payload) => {
      billBus.emit({ ...payload, kind: 'reminder' });
      const fmt =
        Number(payload?.amount || 0) > 0
          ? `AED ${Number(payload.amount).toFixed(2)}`
          : 'variable amount';
      if (payload.type === 'overdue') {
        const days = Math.abs(payload.daysUntilDue || 0);
        toast.error(
          `${payload.billName} is overdue by ${days} day${days === 1 ? '' : 's'} (${fmt}).`,
        );
      } else if (payload.type === 'due_today') {
        toast.warning(`${payload.billName} is due today (${fmt}).`);
      } else {
        toast.info(
          `${payload.billName} is due in ${payload.daysUntilDue || 0} days (${fmt}).`,
        );
      }
    });
    socket.on('bill_paid', (payload) => {
      billBus.emit({ ...payload, kind: 'paid' });
      toast.success(
        `${payload.billName} marked paid (AED ${Number(payload.amount || 0).toFixed(2)}).`,
      );
    });
    socket.on('expense_recorded', (payload) => {
      expenseBus.emit({ ...payload, kind: 'recorded' });
    });

    // Phase 16 — notifications channel.
    socket.on('notification_new', (payload) => {
      const notification = payload?.notification;
      if (!notification) return;
      useNotificationStore.getState().addNotification(notification);
      if (typeof payload.unread_count === 'number') {
        useNotificationStore.getState().setUnreadCount(payload.unread_count);
      }
      if (notification.category === 'approval') {
        useNotificationStore.getState().fetchApprovalCount();
      }
    });

    socket.on('notification_read_ack', (payload) => {
      if (typeof payload?.unread_count === 'number') {
        useNotificationStore.getState().setUnreadCount(payload.unread_count);
      }
    });

    // Phase 17 — backup + restore lifecycle.
    socket.on('backup_started', (payload) => {
      useBackupStore.getState().onBackupStarted(payload);
    });
    socket.on('backup_completed', (payload) => {
      useBackupStore.getState().onBackupCompleted(payload);
    });
    socket.on('backup_failed', (payload) => {
      useBackupStore.getState().onBackupFailed(payload);
    });
    socket.on('restore_imminent', (payload) => {
      useBackupStore.getState().onRestoreImminent(payload);
    });
    socket.on('restore_progress', (payload) => {
      useBackupStore.getState().onRestoreProgress(payload);
    });
    socket.on('restore_completed', (payload) => {
      useBackupStore.getState().onRestoreCompleted(payload);
    });
    socket.on('disk_space_warning', (payload) => {
      useBackupStore.getState().onDiskWarning(payload);
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
