import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from './posStore';

// Smoke test for the POS cart's client-side total calculation (audit
// finding MED-10: web/ had zero tests of any kind before this). Pure
// Zustand store logic — no React rendering needed. This mirrors
// server/services/invoiceService.js's computeTotals math (a duplicated
// implementation, since the client shows a live running total before the
// cart is ever sent to the server) — the server remains the authority at
// confirm time (see CODEBASE_AUDIT.md FE-6), this only proves what the
// cashier sees while building the cart adds up correctly.
describe('usePosStore.calculateTotals', () => {
  beforeEach(() => {
    usePosStore.getState().clearCart();
  });

  it('computes subtotal, tax, and total for a single item with no discount', () => {
    usePosStore.getState().addToCart({ variantId: 'v1', sellingPrice: 50 }, 2);
    const totals = usePosStore.getState().calculateTotals();

    expect(totals.subtotal).toBe(100);
    expect(totals.itemDiscount).toBe(0);
    expect(totals.taxable).toBe(100);
    expect(totals.taxRate).toBe(5);
    expect(totals.tax).toBe(5);
    expect(totals.total).toBe(105);
    expect(totals.balanceDue).toBe(105);
  });

  it('stacks a per-line discount with an invoice-level discount', () => {
    usePosStore.getState().addToCart({ variantId: 'v1', sellingPrice: 100 }, 1);
    usePosStore.setState((s) => ({
      cart: s.cart.map((i) => (i.variantId === 'v1' ? { ...i, discountAmount: 10 } : i)),
    }));
    usePosStore.getState().setInvoiceDiscount(5);

    const totals = usePosStore.getState().calculateTotals();

    // subtotal=100, lineDiscount=10, invoiceDiscount=5, discount=15
    // taxable=85, tax=4.25, total=89.25
    expect(totals.subtotal).toBe(100);
    expect(totals.discount).toBe(15);
    expect(totals.taxable).toBe(85);
    expect(totals.tax).toBe(4.25);
    expect(totals.total).toBe(89.25);
  });

  it('sums multiple cart lines and reflects a partial payment in balanceDue', () => {
    usePosStore.getState().addToCart({ variantId: 'v1', sellingPrice: 10 }, 3);
    usePosStore.getState().addToCart({ variantId: 'v2', sellingPrice: 20 }, 2);
    usePosStore.setState({ payments: [{ id: 'p1', method: 'cash', amount: 50 }] });

    const totals = usePosStore.getState().calculateTotals();

    // subtotal = 30 + 40 = 70, tax = 3.5, total = 73.5, paid = 50
    expect(totals.subtotal).toBe(70);
    expect(totals.total).toBe(73.5);
    expect(totals.amountPaid).toBe(50);
    expect(totals.balanceDue).toBe(23.5);
  });

  it('adding the same variant twice increases quantity rather than duplicating the line', () => {
    usePosStore.getState().addToCart({ variantId: 'v1', sellingPrice: 10 }, 1);
    usePosStore.getState().addToCart({ variantId: 'v1', sellingPrice: 10 }, 2);

    const totals = usePosStore.getState().calculateTotals();
    expect(totals.items).toHaveLength(1);
    expect(totals.items[0].quantity).toBe(3);
    expect(totals.subtotal).toBe(30);
  });
});

describe('usePosStore.setCustomer', () => {
  beforeEach(() => {
    usePosStore.getState().clearCart();
    usePosStore.getState().setCustomer(null);
  });

  it('selects Guest ({ id: null, name: "Guest" }) instead of silently discarding it', () => {
    // Regression: `customer && customer.id` treated the Guest sentinel's
    // null id as falsy and reset selectedCustomer back to null, so clicking
    // "Guest (no account)" in CustomerSelect appeared to do nothing.
    usePosStore.getState().setCustomer({ id: null, name: 'Guest' });
    expect(usePosStore.getState().selectedCustomer).toEqual({ id: null, name: 'Guest' });
  });

  it('selects a registered customer normally', () => {
    usePosStore.getState().setCustomer({ id: 'c1', name: 'Ali' });
    expect(usePosStore.getState().selectedCustomer).toEqual({ id: 'c1', name: 'Ali' });
  });

  it('clears credit payments when switching to Guest', () => {
    usePosStore.getState().setCustomer({ id: 'c1', name: 'Ali' });
    usePosStore.setState({ payments: [{ id: 'p1', method: 'credit', amount: 20 }] });

    usePosStore.getState().setCustomer({ id: null, name: 'Guest' });

    expect(usePosStore.getState().payments).toHaveLength(0);
  });

  it('keeps credit payments when switching between two registered customers', () => {
    usePosStore.getState().setCustomer({ id: 'c1', name: 'Ali' });
    usePosStore.setState({ payments: [{ id: 'p1', method: 'credit', amount: 20 }] });

    usePosStore.getState().setCustomer({ id: 'c2', name: 'Sara' });

    expect(usePosStore.getState().payments).toHaveLength(1);
  });
});
