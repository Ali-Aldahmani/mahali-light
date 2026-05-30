/**
 * Unit tests for invoiceService pure functions.
 *
 * computeTotals, computeLineFigures, and shortenPcCode have zero DB or I/O
 * dependencies, so we can test them directly after mocking the modules that
 * invoiceService.js pulls in at load-time.
 */
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any import of the module under
// test so vitest can hoist them above the static imports.
// ---------------------------------------------------------------------------
vi.mock('../../server/db/postgres', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  withTransaction: vi.fn(),
}));
vi.mock('../../server/utils/docNumbers', () => ({
  nextDocumentNumber: vi.fn(),
}));
vi.mock('../../server/services/stockService', () => ({
  applyStockMovement: vi.fn(),
  emitDeferred: vi.fn(),
  isVariantUnderActiveCount: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../server/services/customerService', () => ({
  assertWithinCreditLimit: vi.fn(),
}));
vi.mock('../../server/utils/activityLog', () => ({
  logActivity: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../server/config/storeSettings', () => ({
  getStoreSettings: vi.fn().mockResolvedValue({ taxRate: 5 }),
}));
vi.mock('../../server/services/warrantyService', () => ({
  createWarrantiesFromInvoice: vi.fn(),
  voidWarrantiesForInvoice: vi.fn(),
}));
vi.mock('../../server/services/cashService', () => ({
  recordEntry: vi.fn(),
  getOpenDrawer: vi.fn(),
}));
vi.mock('../../server/services/bankService', () => ({
  recordEntry: vi.fn(),
}));
vi.mock('../../server/services/journalService', () => ({
  postMany: vi.fn(),
  post: vi.fn(),
  postStockAdjustmentEntry: vi.fn(),
}));
vi.mock('../../server/services/notificationService', () => ({
  notifyRoles: vi.fn().mockResolvedValue(null),
  notifyUser: vi.fn().mockResolvedValue(null),
  notifyManagersAndAdmins: vi.fn().mockResolvedValue(null),
}));

import {
  computeTotals,
  computeLineFigures,
  shortenPcCode,
} from '../../server/services/invoiceService.js';

// ---------------------------------------------------------------------------
// computeTotals
// ---------------------------------------------------------------------------
describe('computeTotals', () => {
  it('computes a simple paid invoice with no discounts', () => {
    const result = computeTotals({
      items: [{ quantity: 2, unit_price: 50, discount_amount: 0 }],
      payments: [{ amount: 105 }], // 100 * 1.05 (5% tax)
    });

    expect(result.subtotal).toBe(100);
    expect(result.discountAmount).toBe(0);
    expect(result.taxableAmount).toBe(100);
    expect(result.taxRate).toBe(5);
    expect(result.taxAmount).toBe(5);
    expect(result.total).toBe(105);
    expect(result.amountPaid).toBe(105);
    expect(result.balanceDue).toBe(0);
    expect(result.paymentStatus).toBe('paid');
  });

  it('applies item-level discount before computing tax', () => {
    const result = computeTotals({
      items: [{ quantity: 1, unit_price: 200, discount_amount: 20 }],
      payments: [],
    });

    expect(result.subtotal).toBe(200);
    expect(result.discountAmount).toBe(20);
    expect(result.taxableAmount).toBe(180);
    expect(result.taxAmount).toBe(9); // 180 * 5%
    expect(result.total).toBe(189);
    expect(result.balanceDue).toBe(189);
    expect(result.paymentStatus).toBe('unpaid');
  });

  it('applies invoice-level discount stacked on top of item discounts', () => {
    const result = computeTotals({
      items: [{ quantity: 1, unit_price: 100, discount_amount: 10 }],
      payments: [],
      invoiceDiscount: 5,
    });

    // subtotal=100, itemDiscount=10, invDisc=5, total discount=15
    // taxable = 100 - 15 = 85
    // tax = 85 * 5% = 4.25
    // total = 89.25
    expect(result.subtotal).toBe(100);
    expect(result.discountAmount).toBe(15);
    expect(result.invoiceDiscount).toBe(5);
    expect(result.taxableAmount).toBe(85);
    expect(result.taxAmount).toBe(4.25);
    expect(result.total).toBe(89.25);
  });

  it('reports partial payment correctly', () => {
    const result = computeTotals({
      items: [{ quantity: 1, unit_price: 100, discount_amount: 0 }],
      payments: [{ amount: 50 }],
    });

    expect(result.total).toBe(105);
    expect(result.amountPaid).toBe(50);
    expect(result.balanceDue).toBe(55);
    expect(result.paymentStatus).toBe('partial');
  });

  it('respects a custom tax rate', () => {
    const result = computeTotals({
      items: [{ quantity: 1, unit_price: 100, discount_amount: 0 }],
      payments: [],
      taxRate: 0,
    });

    expect(result.taxAmount).toBe(0);
    expect(result.total).toBe(100);
  });

  it('clamps negative invoice discount to zero', () => {
    const result = computeTotals({
      items: [{ quantity: 1, unit_price: 100, discount_amount: 0 }],
      payments: [],
      invoiceDiscount: -50,
    });

    // Negative invoice discount is ignored (clamped to 0).
    expect(result.invoiceDiscount).toBe(0);
    expect(result.discountAmount).toBe(0);
    expect(result.taxableAmount).toBe(100);
  });

  it('handles zero-value items without exploding', () => {
    const result = computeTotals({
      items: [],
      payments: [],
    });

    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
    expect(result.balanceDue).toBe(0);
    expect(result.paymentStatus).toBe('unpaid');
  });

  it('correctly sums multiple items', () => {
    const result = computeTotals({
      items: [
        { quantity: 3, unit_price: 10, discount_amount: 0 },
        { quantity: 2, unit_price: 20, discount_amount: 5 },
      ],
      payments: [],
    });

    // 30 + 40 = 70 subtotal, discount = 5, taxable = 65, tax = 3.25, total = 68.25
    expect(result.subtotal).toBe(70);
    expect(result.discountAmount).toBe(5);
    expect(result.taxableAmount).toBe(65);
    expect(result.taxAmount).toBe(3.25);
    expect(result.total).toBe(68.25);
  });
});

// ---------------------------------------------------------------------------
// computeLineFigures
// ---------------------------------------------------------------------------
describe('computeLineFigures', () => {
  it('computes a line with no discount', () => {
    const result = computeLineFigures({ quantity: 4, unit_price: 25 });

    expect(result.lineSubtotal).toBe(100);
    expect(result.discountAmount).toBe(0);
    expect(result.lineTotal).toBe(100);
  });

  it('applies an explicit discount_amount', () => {
    const result = computeLineFigures({
      quantity: 2,
      unit_price: 50,
      discount_amount: 10,
    });

    expect(result.lineSubtotal).toBe(100);
    expect(result.discountAmount).toBe(10);
    expect(result.lineTotal).toBe(90);
  });

  it('derives discount_amount from discount_percent when amount is absent', () => {
    const result = computeLineFigures({
      quantity: 1,
      unit_price: 200,
      discount_percent: 10,
    });

    expect(result.discountAmount).toBe(20);
    expect(result.lineTotal).toBe(180);
  });

  it('prefers explicit discount_amount over discount_percent', () => {
    // Both present — explicit amount wins (percent only used when amount is 0).
    const result = computeLineFigures({
      quantity: 1,
      unit_price: 100,
      discount_amount: 15,
      discount_percent: 50, // ignored because discount_amount is set
    });

    expect(result.discountAmount).toBe(15);
    expect(result.lineTotal).toBe(85);
  });

  it('clamps discount to line subtotal so lineTotal never goes negative', () => {
    const result = computeLineFigures({
      quantity: 1,
      unit_price: 10,
      discount_amount: 999, // absurd discount
    });

    expect(result.discountAmount).toBe(10); // clamped to subtotal
    expect(result.lineTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shortenPcCode
// ---------------------------------------------------------------------------
describe('shortenPcCode', () => {
  it('strips non-alphanumeric characters and uppercases', () => {
    expect(shortenPcCode('pc-1')).toBe('PC1');
    expect(shortenPcCode('pc 2')).toBe('PC2');
    expect(shortenPcCode('PC-3')).toBe('PC3');
  });

  it('falls back to P0 for null, undefined, or empty input', () => {
    expect(shortenPcCode(null)).toBe('P0');
    expect(shortenPcCode(undefined)).toBe('P0');
    expect(shortenPcCode('')).toBe('P0');
    expect(shortenPcCode('---')).toBe('P0'); // all non-alphanumeric
  });

  it('truncates to 6 characters', () => {
    expect(shortenPcCode('WORKSTATION1234')).toBe('WORKST');
  });

  it('passes through clean short codes unchanged', () => {
    expect(shortenPcCode('P1')).toBe('P1');
    expect(shortenPcCode('SALES1')).toBe('SALES1');
  });
});
