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
