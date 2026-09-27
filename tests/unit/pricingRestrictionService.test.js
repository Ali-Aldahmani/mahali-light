import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assertPriceAllowed,
  evaluatePriceRestrictions,
} = require('../../server/services/pricingRestrictionService');

// Rows as stored in pricing_restrictions: a NULL column = rule disabled.
function rules({ min = null, pct = null, amt = null } = {}) {
  return { min_price: min, max_discount_percent: pct, max_discount_amount: amt };
}

function violated(restriction, catalogPrice, netUnitPrice) {
  return evaluatePriceRestrictions({ restriction, catalogPrice, netUnitPrice }).map(
    (v) => v.restrictionType,
  );
}

function thrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

describe('pricingRestrictionService.evaluatePriceRestrictions', () => {
  it('no restriction row: everything allowed', () => {
    expect(violated(null, 100, 0.01)).toEqual([]);
  });

  it('row with every rule disabled: everything allowed', () => {
    expect(violated(rules(), 100, 0.01)).toEqual([]);
  });

  describe('minimum price only', () => {
    it('allows a net price at or above the floor', () => {
      expect(violated(rules({ min: 50 }), 100, 50)).toEqual([]);
      expect(violated(rules({ min: 50 }), 100, 75)).toEqual([]);
    });

    it('rejects a net price below the floor, however it was reached', () => {
      expect(violated(rules({ min: 50 }), 100, 49.99)).toEqual(['MINIMUM_PRICE']);
      expect(violated(rules({ min: 50 }), 100, 10)).toEqual(['MINIMUM_PRICE']);
    });

    it('is tolerant of sub-cent floating point noise', () => {
      expect(violated(rules({ min: 50 }), 100, 49.999)).toEqual([]);
    });
  });

  describe('max discount % only', () => {
    it('allows a discount at or under the cap', () => {
      expect(violated(rules({ pct: 10 }), 100, 90)).toEqual([]);
    });

    it('rejects a discount over the cap, measured against catalog price', () => {
      expect(violated(rules({ pct: 10 }), 100, 89)).toEqual(['MAX_DISCOUNT_PERCENT']);
    });
  });

  describe('max discount amount only', () => {
    it('allows a per-unit discount at or under the cap', () => {
      expect(violated(rules({ amt: 5 }), 100, 95)).toEqual([]);
    });

    it('rejects a per-unit discount over the cap', () => {
      expect(violated(rules({ amt: 5 }), 100, 94)).toEqual(['MAX_DISCOUNT_AMOUNT']);
    });
  });

  describe('minimum price + max discount %', () => {
    const r = rules({ min: 100, pct: 5 });

    it('allows 5% off 120 (114 >= 100 and 5% <= 5%)', () => {
      expect(violated(r, 120, 114)).toEqual([]);
    });

    it('rejects when only the percent cap is broken', () => {
      expect(violated(r, 120, 110)).toEqual(['MAX_DISCOUNT_PERCENT']);
    });

    it('rejects when only the floor is broken (price override below min, no discount)', () => {
      // Catalog 102 -> 99 is ~2.9% off (within 5%) but below the 100 floor.
      expect(violated(r, 102, 99)).toEqual(['MINIMUM_PRICE']);
    });
  });

  describe('minimum price + max discount amount', () => {
    const r = rules({ min: 100, amt: 15 });

    it('allows a price satisfying both', () => {
      expect(violated(r, 120, 105)).toEqual([]);
    });

    it('rejects a discount over the amount cap while the floor passes', () => {
      expect(violated(r, 130, 110)).toEqual(['MAX_DISCOUNT_AMOUNT']);
    });

    it('rejects when both are broken', () => {
      expect(violated(r, 120, 90)).toEqual(['MINIMUM_PRICE', 'MAX_DISCOUNT_AMOUNT']);
    });
  });

  describe('max discount % + max discount amount', () => {
    const r = rules({ pct: 20, amt: 15 });

    it('allows a discount within both caps', () => {
      expect(violated(r, 100, 90)).toEqual([]);
    });

    it('amount cap binds first on an expensive item', () => {
      // 200 -> 170 is 15% (ok) but AED 30 off (> 15).
      expect(violated(r, 200, 170)).toEqual(['MAX_DISCOUNT_AMOUNT']);
    });

    it('percent cap binds first on a cheap item', () => {
      // 50 -> 38 is AED 12 off (ok) but 24% (> 20%).
      expect(violated(r, 50, 38)).toEqual(['MAX_DISCOUNT_PERCENT']);
    });
  });

  describe('all three enabled', () => {
    const r = rules({ min: 100, pct: 20, amt: 15 });

    it('allows a price that satisfies every rule', () => {
      expect(violated(r, 120, 110)).toEqual([]);
    });

    it('rejects when only one rule fails while the other two pass', () => {
      // 120 -> 100: floor ok, 16.7% ok, AED 20 off > 15.
      expect(violated(r, 120, 100)).toEqual(['MAX_DISCOUNT_AMOUNT']);
    });

    it('reports every violated rule', () => {
      expect(violated(r, 120, 50)).toEqual([
        'MINIMUM_PRICE',
        'MAX_DISCOUNT_PERCENT',
        'MAX_DISCOUNT_AMOUNT',
      ]);
    });
  });
});

describe('pricingRestrictionService.assertPriceAllowed', () => {
  it('does not throw when nothing is violated', () => {
    expect(() =>
      assertPriceAllowed({ restriction: rules({ min: 100, pct: 5 }), catalogPrice: 120, netUnitPrice: 114 }),
    ).not.toThrow();
  });

  it('throws one 422 listing each violation with a clear message', () => {
    const err = thrown(() =>
      assertPriceAllowed({
        restriction: rules({ min: 100, pct: 5, amt: 15 }),
        catalogPrice: 120,
        netUnitPrice: 90,
        productName: 'Lamp',
      }),
    );
    expect(err).toBeTruthy();
    expect(err.code).toBe('BIZ_PRICING_RESTRICTION_VIOLATION');
    expect(err.status).toBe(422);
    expect(err.message).toContain('Lamp');
    expect(err.message).toContain('Minimum selling price is AED 100.00.');
    expect(err.message).toContain('Maximum allowed discount is 5%.');
    expect(err.message).toContain('Maximum allowed discount amount is AED 15.00.');
    expect(err.details.violations.map((v) => v.restrictionType)).toEqual([
      'MINIMUM_PRICE',
      'MAX_DISCOUNT_PERCENT',
      'MAX_DISCOUNT_AMOUNT',
    ]);
  });

  it('names only the rule that failed', () => {
    const err = thrown(() =>
      assertPriceAllowed({ restriction: rules({ min: 100, pct: 5 }), catalogPrice: 120, netUnitPrice: 110 }),
    );
    expect(err.message).toContain('Maximum allowed discount is 5%.');
    expect(err.message).not.toContain('Minimum selling price');
  });
});
