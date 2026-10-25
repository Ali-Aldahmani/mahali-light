import { useEffect } from 'react';
import { usePosStore } from '@/store/posStore';

export const SALE_BACKUP_KEY = 'mahali.cashier.sale';

interface SaleBackup {
  userId: string | number | null;
  savedAt: number;
  cart: any[];
  selectedCustomer: any | null;
  invoiceDiscount: number;
  notes: string;
  draftInvoiceId: string | null;
  draftInvoiceNumber: string | null;
  /** The sale attempt's ID, so after a reload a lost checkout can be looked up and not repeated. */
  checkoutId?: string | null;
  /** Payment lines with their IDs, which double as their request keys. */
  payments?: any[];
}

export function readSaleBackup(userId: string | number | null): SaleBackup | null {
  try {
    const raw = sessionStorage.getItem(SALE_BACKUP_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaleBackup;
    if (!data || !Array.isArray(data.cart) || data.userId !== userId) return null;
    return data;
  } catch (_e) {
    return null;
  }
}

export function clearSaleBackup() {
  try {
    sessionStorage.removeItem(SALE_BACKUP_KEY);
  } catch (_e) {
    /* ignore */
  }
}

// Keeps a tab-scoped copy of the in-progress sale so a reload or an
// accidental navigation doesn't lose the cart — or its checkout ID and
// payment keys, which make a checkout interrupted by the reload safe to
// look up and retry. Only sale intent is stored;
// prices and totals are re-derived and re-validated by the server at pay time.
export function useSaleBackup(userId: string | number | null) {
  useEffect(() => {
    const state = usePosStore.getState();
    if (!state.cart.length) {
      const backup = readSaleBackup(userId);
      if (backup?.cart.length) {
        state.loadSale({
          // JSON turns Infinity into null; custom lines are never stock-limited.
          cart: backup.cart.map((it) => (it.isCustom ? { ...it, stockQty: Infinity } : it)),
          selectedCustomer: backup.selectedCustomer,
          invoiceDiscount: backup.invoiceDiscount,
          notes: backup.notes,
          draftInvoiceId: backup.draftInvoiceId,
          draftInvoiceNumber: backup.draftInvoiceNumber,
          checkoutId: backup.checkoutId,
          payments: backup.payments,
        });
      }
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const write = () => {
      timer = null;
      const s = usePosStore.getState();
      try {
        if (!s.cart.length && !s.draftInvoiceId) {
          sessionStorage.removeItem(SALE_BACKUP_KEY);
          return;
        }
        const backup: SaleBackup = {
          userId,
          savedAt: Date.now(),
          cart: s.cart,
          selectedCustomer: s.selectedCustomer,
          invoiceDiscount: s.invoiceDiscount,
          notes: s.notes,
          draftInvoiceId: s.draftInvoiceId,
          draftInvoiceNumber: s.draftInvoiceNumber,
          checkoutId: s.checkoutId,
          payments: s.payments,
        };
        sessionStorage.setItem(SALE_BACKUP_KEY, JSON.stringify(backup));
      } catch (_e) {
        /* quota / private mode — the in-memory cart is still intact */
      }
    };
    const unsubscribe = usePosStore.subscribe((s, prev) => {
      if (
        s.cart === prev.cart &&
        s.selectedCustomer === prev.selectedCustomer &&
        s.invoiceDiscount === prev.invoiceDiscount &&
        s.notes === prev.notes &&
        s.draftInvoiceId === prev.draftInvoiceId &&
        s.checkoutId === prev.checkoutId &&
        s.payments === prev.payments
      ) {
        return;
      }
      if (!timer) timer = setTimeout(write, 300);
    });
    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
        write();
      }
    };
  }, [userId]);
}
