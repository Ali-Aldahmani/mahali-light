import { create } from 'zustand';

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

export const productBus = makeBus();
export const stockBus = makeBus();
export const reorderBus = makeBus();
export const adjustmentBus = makeBus();
export const countBus = makeBus();
export const poBus = makeBus();
export const supplierReturnBus = makeBus();
export const customerBus = makeBus();
export const invoiceBus = makeBus();
export const invoiceEditRequestBus = makeBus();
export const pdfBus = makeBus();
export const printBus = makeBus();
export const warrantyBus = makeBus();
export const warrantyClaimBus = makeBus();
export const returnBus = makeBus();
export const treasuryBus = makeBus();
export const attendanceBus = makeBus();
export const leaveBus = makeBus();
export const correctionBus = makeBus();
export const holidayBus = makeBus();
export const billBus = makeBus();
export const expenseBus = makeBus();

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

export const useSocketStore = create((set) => ({
  socket: null,
  isConnected: true, // Always show "Live" in demo mode
  connect: () => set({ isConnected: true }),
  disconnect: () => set({ isConnected: false }),
  emit: () => {},
}));
