import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { refundableLineValues, validateRefundPlan } = require('../../server/services/returnService');

describe('discounted return amounts', () => {
  it('allocates invoice discounts and tax over net line values, preserving every cent', () => {
    const values = refundableLineValues({ total: '10.01' }, [
      { id: 'a', line_total: '10.00' }, { id: 'b', line_total: '10.00' }, { id: 'c', line_total: '10.00' },
    ]);
    expect([...values.values()]).toEqual([3.34, 3.33, 3.34]);
    expect(Math.round([...values.values()].reduce((a, b) => a + b, 0) * 100)).toBe(1001);
  });
  it('fully discounted items have no refundable value', () => {
    expect(refundableLineValues({ total: 0 }, [{ id: 'a', line_total: 0 }]).get('a')).toBe(0);
  });
  it('allows an unplanned request but refuses approval without its full payout', () => {
    expect(validateRefundPlan([], 75)).toBeNull();
    expect(() => validateRefundPlan([], 75, { required: true })).toThrow();
    expect(() => validateRefundPlan([{ method: 'cash', amount: 74.99 }], 75, { required: true })).toThrow();
    expect(() => validateRefundPlan([{ method: 'cash', amount: 75.01 }], 75, { required: true })).toThrow();
    expect(validateRefundPlan([{ method: 'cash', amount: 75 }], 75, { required: true })[0].amount).toBe(75);
  });
  it.each([NaN, Infinity, -1, 0])('rejects an invalid refund amount %s', (amount) => {
    expect(() => validateRefundPlan([{ method: 'cash', amount }], 75, { required: true })).toThrow();
  });
});
