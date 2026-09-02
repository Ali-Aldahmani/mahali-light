import { create } from 'zustand';

// Pure client-side cart store. Items only get persisted to the server when
// the cashier confirms the invoice. This keeps every cart edit instantaneous
// (no API calls) which is critical for the POS UX.
//
// Cart item shape:
//   {
//     variantId, productId, productName, sku, unitLabel, soldBy,
//     attributes: [{ name, value, unit }],
//     stockQty, imagePath,
//     unitPrice,        // mutable per line override
//     quantity,         // numeric (decimals allowed for meter/kg)
//     discountAmount,   // AED off the line (always derived from percent)
//     discountPercent,  // % off the line (preferred input)
//   }

const DEFAULT_TAX_RATE = 5;
const PC_IDENTIFIER_KEY = 'mahali.pcIdentifier';
const OFFLINE_QUEUE_KEY = 'mahali.posOfflineQueue';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function loadOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_e) {
    return [];
  }
}

function saveOfflineQueue(queue) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (_e) {
    // ignore — quota errors handled by UI
  }
}

function loadPcIdentifier() {
  try {
    const existing = localStorage.getItem(PC_IDENTIFIER_KEY);
    if (existing) return existing;
    const generated = `P${Math.floor(Math.random() * 90) + 10}`;
    localStorage.setItem(PC_IDENTIFIER_KEY, generated);
    return generated;
  } catch (_e) {
    return 'P0';
  }
}

function computeLineTotal(item) {
  const subtotal = round2(Number(item.quantity) * Number(item.unitPrice));
  let discount = round2(item.discountAmount || 0);
  const pct = Number(item.discountPercent || 0);
  if (pct > 0 && !discount) discount = round2(subtotal * (pct / 100));
  if (discount > subtotal) discount = subtotal;
  return {
    lineSubtotal: subtotal,
    lineDiscount: discount,
    lineTotal: round2(subtotal - discount),
  };
}

function computeTotals(state) {
  const items = state.cart.map((it) => ({ ...it, ...computeLineTotal(it) }));
  const subtotal = items.reduce((s, i) => s + i.lineSubtotal, 0);
  const itemDiscount = items.reduce((s, i) => s + i.lineDiscount, 0);
  const invoiceDiscount = round2(state.invoiceDiscount || 0);
  const discount = round2(itemDiscount + invoiceDiscount);
  const taxable = Math.max(0, round2(subtotal - discount));
  const taxRate = Number(state.taxRate || DEFAULT_TAX_RATE);
  const tax = round2(taxable * (taxRate / 100));
  const total = round2(taxable + tax);
  const amountPaid = state.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balanceDue = round2(total - amountPaid);
  return {
    items,
    subtotal: round2(subtotal),
    itemDiscount: round2(itemDiscount),
    invoiceDiscount,
    discount,
    taxable,
    taxRate,
    tax,
    total,
    amountPaid: round2(amountPaid),
    balanceDue,
  };
}

export const usePosStore = create((set, get) => ({
  cart: [],
  selectedCustomer: null,
  payments: [],
  invoiceDiscount: 0,
  taxRate: DEFAULT_TAX_RATE,
  notes: '',
  pcIdentifier: loadPcIdentifier(),
  isOffline: false,
  offlineQueue: loadOfflineQueue(),

  setOffline(flag) {
    set({ isOffline: !!flag });
  },

  setPcIdentifier(pc) {
    try {
      localStorage.setItem(PC_IDENTIFIER_KEY, pc);
    } catch (_e) {
      // ignore
    }
    set({ pcIdentifier: pc });
  },

  setCustomer(customer) {
    set((state) => {
      // Guest is `{ id: null, name: 'Guest' }` — a real selection, distinct
      // from `null` (no selection). Only collapse to null when the caller
      // actually passed null/undefined (i.e. cleared the field).
      const next = customer || null;
      // Neither guest nor no-selection can keep credit payments — only a
      // registered account (a real id) can.
      const hasAccount = Boolean(next && next.id);
      const payments = hasAccount
        ? state.payments
        : state.payments.filter((p) => p.method !== 'credit');
      return { selectedCustomer: next, payments };
    });
  },

  addToCart(variant, quantity = 1) {
    if (!variant?.variantId) return;
    const qty = Number(quantity) || 1;
    set((state) => {
      const existing = state.cart.find((i) => i.variantId === variant.variantId);
      if (existing) {
        return {
          cart: state.cart.map((i) =>
            i.variantId === variant.variantId
              ? { ...i, quantity: round2(Number(i.quantity) + qty) }
              : i,
          ),
        };
      }
      const item = {
        variantId: variant.variantId,
        productId: variant.productId,
        productName: variant.productName,
        sku: variant.sku,
        unitLabel: variant.unitLabel || 'pcs',
        soldBy: variant.soldBy || 'piece',
        attributes: variant.attributes || [],
        stockQty: Number(variant.stockQty || 0),
        imagePath: variant.imagePath || null,
        unitPrice: round2(variant.sellingPrice || 0),
        quantity: qty,
        discountAmount: 0,
        discountPercent: 0,
        serialNumber: '',
        serialValid: true,
        serialError: null,
        requiresSerial: !!variant.requiresSerial,
        defaultWarrantyMonths: Number(variant.defaultWarrantyMonths || 0),
      };
      return { cart: [...state.cart, item] };
    });
  },

  setSerial(variantId, serial, { valid = true, error = null } = {}) {
    set((state) => ({
      cart: state.cart.map((i) =>
        i.variantId === variantId
          ? {
              ...i,
              serialNumber: serial || '',
              serialValid: !!valid,
              serialError: error || null,
            }
          : i,
      ),
    }));
  },

  updateQty(variantId, qty) {
    set((state) => ({
      cart: state.cart.map((i) =>
        i.variantId === variantId ? { ...i, quantity: round2(qty) } : i,
      ),
    }));
  },

  updateUnitPrice(variantId, unitPrice) {
    set((state) => ({
      cart: state.cart.map((i) =>
        i.variantId === variantId ? { ...i, unitPrice: round2(unitPrice) } : i,
      ),
    }));
  },

  setLineDiscount(variantId, { percent, amount } = {}) {
    set((state) => ({
      cart: state.cart.map((i) => {
        if (i.variantId !== variantId) return i;
        if (percent != null) {
          return {
            ...i,
            discountPercent: Number(percent) || 0,
            discountAmount: 0,
          };
        }
        if (amount != null) {
          return {
            ...i,
            discountAmount: round2(amount),
            discountPercent: 0,
          };
        }
        return i;
      }),
    }));
  },

  removeFromCart(variantId) {
    set((state) => ({
      cart: state.cart.filter((i) => i.variantId !== variantId),
    }));
  },

  setInvoiceDiscount(amount) {
    set({ invoiceDiscount: round2(amount) });
  },

  setNotes(notes) {
    set({ notes });
  },

  // Payments ----------------------------------------------------------------

  addPayment(method, amount) {
    set((state) => {
      if (method === 'credit' && !state.selectedCustomer?.id) return state;
      return {
        payments: [
          ...state.payments,
          {
            id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            method,
            amount: round2(amount),
          },
        ],
      };
    });
  },

  updatePayment(id, patch) {
    set((state) => ({
      payments: state.payments.map((p) =>
        p.id === id
          ? { ...p, ...patch, amount: patch.amount != null ? round2(patch.amount) : p.amount }
          : p,
      ),
    }));
  },

  removePayment(id) {
    set((state) => ({ payments: state.payments.filter((p) => p.id !== id) }));
  },

  clearPayments() {
    set({ payments: [] });
  },

  // Totals ------------------------------------------------------------------

  calculateTotals() {
    return computeTotals(get());
  },

  clearCart() {
    set({
      cart: [],
      payments: [],
      invoiceDiscount: 0,
      selectedCustomer: null,
      notes: '',
    });
  },

  // Offline queue -----------------------------------------------------------

  enqueueOfflineInvoice(payload) {
    const entry = {
      id: `off-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      payload,
      createdAt: new Date().toISOString(),
      synced: false,
    };
    const queue = [...get().offlineQueue, entry];
    saveOfflineQueue(queue);
    set({ offlineQueue: queue });
    return entry;
  },

  markOfflineSynced(id, result) {
    const queue = get()
      .offlineQueue.map((e) =>
        e.id === id
          ? { ...e, synced: true, syncedAt: new Date().toISOString(), result }
          : e,
      )
      .filter((e) => !e.synced); // drop synced entries after success
    saveOfflineQueue(queue);
    set({ offlineQueue: queue });
  },

  markOfflineError(id, error) {
    const queue = get().offlineQueue.map((e) =>
      e.id === id ? { ...e, syncError: error } : e,
    );
    saveOfflineQueue(queue);
    set({ offlineQueue: queue });
  },
}));

export { computeTotals };
