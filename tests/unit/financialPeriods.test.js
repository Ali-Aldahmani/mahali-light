import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { periodDefinitionsForDate } = require('../../server/services/journalService');

describe('periodDefinitionsForDate', () => {
  it('builds month/quarter/half/year rows named like the 2026 seed', () => {
    expect(periodDefinitionsForDate('2027-01-01')).toEqual([
      { name: 'January 2027', type: 'monthly', start: '2027-01-01', end: '2027-01-31' },
      { name: 'Q1 2027', type: 'quarterly', start: '2027-01-01', end: '2027-03-31' },
      { name: 'H1 2027', type: 'yearly', start: '2027-01-01', end: '2027-06-30' },
      { name: 'FY 2027', type: 'yearly', start: '2027-01-01', end: '2027-12-31' },
    ]);
  });

  it('handles year-end and second-half boundaries', () => {
    const [month, quarter, half] = periodDefinitionsForDate('2027-12-31');
    expect(month).toMatchObject({ name: 'December 2027', start: '2027-12-01', end: '2027-12-31' });
    expect(quarter).toMatchObject({ name: 'Q4 2027', start: '2027-10-01', end: '2027-12-31' });
    expect(half).toMatchObject({ name: 'H2 2027', start: '2027-07-01', end: '2027-12-31' });
  });

  it('respects leap-year February', () => {
    expect(periodDefinitionsForDate('2028-02-10')[0]).toMatchObject({ end: '2028-02-29' });
    expect(periodDefinitionsForDate('2027-02-10')[0]).toMatchObject({ end: '2027-02-28' });
  });

  it('returns nothing for malformed dates', () => {
    expect(periodDefinitionsForDate('not-a-date')).toEqual([]);
    expect(periodDefinitionsForDate('2027-13-01')).toEqual([]);
    expect(periodDefinitionsForDate(null)).toEqual([]);
  });
});
