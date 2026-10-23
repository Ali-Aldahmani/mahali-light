import { describe, expect, it } from 'vitest';
import { stockShortfall } from './stockGuard';

describe('POS stock guard', () => {
  const base = { name: 'LED Bulb', unit: 'pcs', stock: 5 };
  it('allows up to what is in stock', () => {
    expect(stockShortfall({ ...base, requested: 5 })).toBeNull();
    expect(stockShortfall({ ...base, requested: 1 })).toBeNull();
  });
  it('blocks more than is in stock', () => {
    expect(stockShortfall({ ...base, requested: 6 })).toBe('Only 5 pcs of LED Bulb in stock.');
    expect(stockShortfall({ ...base, requested: 20_000_000_008 })).toBe('Only 5 pcs of LED Bulb in stock.');
  });
  it('says out of stock when there is none', () => {
    expect(stockShortfall({ ...base, stock: 0, requested: 1 })).toBe('LED Bulb is out of stock.');
  });
  it('respects decimal stock for metre and kg items', () => {
    expect(stockShortfall({ name: 'Cable', unit: 'm', stock: 12.5, requested: 12.5 })).toBeNull();
    expect(stockShortfall({ name: 'Cable', unit: 'm', stock: 12.5, requested: 12.51 })).toBe('Only 12.5 m of Cable in stock.');
  });
  it('lets custom lines and negative-stock stores through', () => {
    expect(stockShortfall({ ...base, requested: 99, isCustom: true })).toBeNull();
    expect(stockShortfall({ ...base, requested: 99, allowNegative: true })).toBeNull();
    expect(stockShortfall({ ...base, stock: Infinity, requested: 99 })).toBeNull();
  });
});
