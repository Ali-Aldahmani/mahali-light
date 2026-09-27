import { describe, expect, it } from 'vitest';
import { isEditableTarget, resolveShortcut } from './shortcuts';
import { createScanQueue, findExactCodeMatch } from './barcode';
import { cartViolations, evaluatePriceRestrictions, lineViolations } from './pricing';
import { prepareCheckout, buildInvoiceItems } from '@/lib/pos/checkout';
import { cashSuggestions } from '@/components/cashier/CashierPaymentDialog';

describe('cashier shortcuts', () => {
  it('maps function keys everywhere, even while typing', () => {
    expect(resolveShortcut({ key: 'F4' }, { editing: true })).toBe('pay');
    expect(resolveShortcut({ key: 'F2' }, { editing: false })).toBe('focusSearch');
    expect(resolveShortcut({ key: 'F6' }, { editing: true })).toBe('customer');
    expect(resolveShortcut({ key: 'F7' }, { editing: false })).toBe('hold');
  });

  it('never fires character shortcuts inside a text field', () => {
    for (const key of ['/', '+', '-', 'Delete', 'ArrowUp', 'Escape']) {
      expect(resolveShortcut({ key }, { editing: true })).toBeNull();
    }
    expect(resolveShortcut({ key: '-' }, { editing: false })).toBe('qtyDown');
    expect(resolveShortcut({ key: 'Delete' }, { editing: false })).toBe('removeSelected');
  });

  it('ignores modified keys so browser/OS shortcuts keep working', () => {
    expect(resolveShortcut({ key: 'F4', ctrlKey: true }, { editing: false })).toBeNull();
    expect(resolveShortcut({ key: '/', metaKey: true }, { editing: false })).toBeNull();
  });

  it('treats text-like inputs as editable but not buttons or checkboxes', () => {
    const text = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });
});

describe('barcode matching', () => {
  const rows = [
    { variantId: 'a', barcode: '6291041500213', sku: 'LED-12W' },
    { variantId: 'b', internalBarcode: 'INT-LED-000123', sku: 'LED-9W' },
    { variantId: 'c', supplierBarcode: 'SUP-777', sku: 'CBL-1M' },
  ];

  it('matches barcode, internal barcode, supplier barcode and SKU exactly (case-insensitive)', () => {
    expect(findExactCodeMatch(rows, '6291041500213')?.variantId).toBe('a');
    expect(findExactCodeMatch(rows, 'int-led-000123')?.variantId).toBe('b');
    expect(findExactCodeMatch(rows, ' SUP-777 ')?.variantId).toBe('c');
    expect(findExactCodeMatch(rows, 'led-9w')?.variantId).toBe('b');
  });

  it('never falls back to a partial / first match for unknown codes', () => {
    expect(findExactCodeMatch(rows, '629104')).toBeNull();
    expect(findExactCodeMatch(rows, '')).toBeNull();
  });

  it('processes rapid scans strictly in order', async () => {
    const order: string[] = [];
    const queue = createScanQueue(async (code) => {
      await new Promise((r) => setTimeout(r, code === '1' ? 20 : 1));
      order.push(code);
    });
    await Promise.all([queue('1'), queue('2'), queue('3')]);
    expect(order).toEqual(['1', '2', '3']);
  });

  it('keeps processing after a failed scan', async () => {
    const seen: string[] = [];
    const queue = createScanQueue(async (code) => {
      if (code === 'bad') throw new Error('network');
      seen.push(code);
    });
    await expect(queue('bad')).rejects.toThrow('network');
    await queue('good');
    expect(seen).toEqual(['good']);
  });
});

describe('pricing restriction preview (mirrors the server)', () => {
  it('minimum price', () => {
    const v = evaluatePriceRestrictions({ restriction: { minPrice: 100 }, catalogPrice: 120, netUnitPrice: 95 });
    expect(v.map((x) => x.message)).toEqual(['Minimum selling price is AED 100.00.']);
  });

  it('max discount percent and amount', () => {
    expect(
      evaluatePriceRestrictions({ restriction: { maxDiscountPercent: 10 }, catalogPrice: 100, netUnitPrice: 85 })[0].message,
    ).toBe('Maximum allowed discount is 10%.');
    expect(
      evaluatePriceRestrictions({ restriction: { maxDiscountAmount: 5 }, catalogPrice: 100, netUnitPrice: 90 })[0].message,
    ).toBe('Maximum allowed discount amount is AED 5.00.');
  });

  it('reports every violated rule when several are enabled', () => {
    const v = evaluatePriceRestrictions({
      restriction: { minPrice: 100, maxDiscountPercent: 5, maxDiscountAmount: 3 },
      catalogPrice: 120,
      netUnitPrice: 90,
    });
    expect(v.map((x) => x.restrictionType)).toEqual(['MINIMUM_PRICE', 'MAX_DISCOUNT_PERCENT', 'MAX_DISCOUNT_AMOUNT']);
  });

  it('line check uses the per-unit net price', () => {
    const line = { variantId: 'x', quantity: 2, unitPrice: 100, lineTotal: 170, pricingRestriction: { maxDiscountAmount: 10 } };
    expect(lineViolations(line)).toHaveLength(1); // 15 off per unit
    expect(lineViolations({ ...line, lineTotal: 180 })).toHaveLength(0);
  });

  it('spreads the invoice discount by line total', () => {
    const lines = [
      { variantId: 'r', quantity: 1, unitPrice: 100, lineTotal: 100, pricingRestriction: { minPrice: 90 } },
      { variantId: 'f', quantity: 1, unitPrice: 100, lineTotal: 100, pricingRestriction: null },
    ];
    expect(cartViolations(lines, 20).size).toBe(0);
    expect(cartViolations(lines, 30).get('r')?.[0].restrictionType).toBe('MINIMUM_PRICE');
  });
});

describe('shared checkout preparation', () => {
  const base = {
    totals: { items: [{ variantId: 'a', quantity: 1, unitPrice: 105, lineDiscount: 0 }], total: 105, balanceDue: 0 },
    cart: [{ variantId: 'a' }],
  };

  it('keeps only the retained cash amount (change is not a payment)', () => {
    const prep = prepareCheckout({ ...base, payments: [{ id: 'p1', method: 'cash', amount: 200 }], customer: null });
    expect(prep).toEqual({ ok: true, allocations: [{ id: 'p1', method: 'cash', amount: 105 }] });
  });

  it('blocks a guest from leaving a balance and non-cash over-payment', () => {
    const guest = prepareCheckout({
      ...base,
      totals: { ...base.totals, balanceDue: 5 },
      payments: [{ id: 'p1', method: 'cash', amount: 100 }],
      customer: null,
    });
    expect(guest).toEqual({ ok: false, message: 'Cannot leave a balance for a guest customer.' });
    const bank = prepareCheckout({ ...base, payments: [{ id: 'p1', method: 'bank', amount: 200 }], customer: null });
    expect(bank.ok).toBe(false);
  });

  it('puts the remainder on account for a registered customer', () => {
    const prep = prepareCheckout({
      ...base,
      totals: { ...base.totals, balanceDue: 5 },
      payments: [{ id: 'p1', method: 'cash', amount: 100 }],
      customer: { id: 'c1' },
    });
    expect(prep.ok && prep.allocations.at(-1)).toEqual({ id: 'remaining-customer-credit', method: 'credit', amount: 5 });
  });

  it('requires serial numbers for serialised items', () => {
    const prep = prepareCheckout({
      ...base,
      cart: [{ variantId: 'a', productName: 'Router', requiresSerial: true, serialNumber: '' }],
      payments: [{ id: 'p1', method: 'cash', amount: 105 }],
      customer: null,
    });
    expect(prep).toEqual({ ok: false, message: 'Enter a serial number for Router.' });
  });

  it('sends intent only — no totals — to the server', () => {
    const [item] = buildInvoiceItems([{ variantId: 'a', quantity: 2, unitPrice: 5, lineDiscount: 1, lineTotal: 9, serialNumber: '' }]);
    expect(item).toEqual({ variantId: 'a', quantity: 2, unitPrice: 5, discountAmount: 1, serialNumber: null });
  });

  it('suggests round-up cash tenders', () => {
    expect(cashSuggestions(127.5)).toEqual([130, 150, 200, 500]);
    expect(cashSuggestions(0)).toEqual([]);
  });
});
