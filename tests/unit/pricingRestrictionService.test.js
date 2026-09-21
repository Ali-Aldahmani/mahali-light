import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertPriceAllowed } = require('../../server/services/pricingRestrictionService');

function minPriceRestriction(min) {
  return { restriction_type: 'MINIMUM_PRICE', min_price: min };
}
function maxPercentRestriction(pct) {
  return { restriction_type: 'MAX_DISCOUNT_PERCENT', max_discount_percent: pct };
}
function maxAmountRestriction(amt) {
  return { restriction_type: 'MAX_DISCOUNT_AMOUNT', max_discount_amount: amt };
}

describe('pricingRestrictionService.assertPriceAllowed', () => {
  it('does nothing when there is no restriction', () => {
    expect(() =>
      assertPriceAllowed({ restriction: null, catalogPrice: 100, netUnitPrice: 0.01, productName: 'X' }),
    ).not.toThrow();
  });

  describe('MINIMUM_PRICE', () => {
    it('allows a net price at or above the floor', () => {
      expect(() =>
        assertPriceAllowed({ restriction: minPriceRestriction(50), catalogPrice: 100, netUnitPrice: 50 }),
      ).not.toThrow();
      expect(() =>
        assertPriceAllowed({ restriction: minPriceRestriction(50), catalogPrice: 100, netUnitPrice: 75 }),
      ).not.toThrow();
    });

    it('rejects a net price below the floor, however it was reached', () => {
      // Raw override price below the floor.
      expect(() =>
        assertPriceAllowed({ restriction: minPriceRestriction(50), catalogPrice: 100, netUnitPrice: 49.99, productName: 'Lamp' }),
      ).toThrowError(/pricing restriction/i);
      // Full-price unit price discounted down below the floor — same check
      // catches both, since it validates the FINAL net price either way.
      expect(() =>
        assertPriceAllowed({ restriction: minPriceRestriction(50), catalogPrice: 100, netUnitPrice: 10 }),
      ).toThrow();
    });

    it('is tolerant of sub-cent floating point noise', () => {
      expect(() =>
        assertPriceAllowed({ restriction: minPriceRestriction(50), catalogPrice: 100, netUnitPrice: 49.999 }),
      ).not.toThrow();
    });
  });

  describe('MAX_DISCOUNT_PERCENT', () => {
    it('allows a discount at or under the cap', () => {
      expect(() =>
        assertPriceAllowed({ restriction: maxPercentRestriction(10), catalogPrice: 100, netUnitPrice: 90 }),
      ).not.toThrow();
    });

    it('rejects a discount over the cap', () => {
      expect(() =>
        assertPriceAllowed({ restriction: maxPercentRestriction(10), catalogPrice: 100, netUnitPrice: 85, productName: 'Bulb' }),
      ).toThrowError(/pricing restriction/i);
    });

    it('computes percent against the catalog price, not an already-overridden price', () => {
      // catalogPrice=100, cap=10% → floor is netUnitPrice=90 regardless of
      // what unit_price was set to before the discount was applied.
      expect(() =>
        assertPriceAllowed({ restriction: maxPercentRestriction(10), catalogPrice: 100, netUnitPrice: 89 }),
      ).toThrow();
    });
  });

  describe('MAX_DISCOUNT_AMOUNT', () => {
    it('allows a discount at or under the per-unit cap', () => {
      expect(() =>
        assertPriceAllowed({ restriction: maxAmountRestriction(5), catalogPrice: 100, netUnitPrice: 95 }),
      ).not.toThrow();
    });

    it('rejects a discount over the per-unit cap', () => {
      expect(() =>
        assertPriceAllowed({ restriction: maxAmountRestriction(5), catalogPrice: 100, netUnitPrice: 94, productName: 'Cable' }),
      ).toThrowError(/pricing restriction/i);
    });
  });
});
