import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const analytics = require('../../server/services/analyticsService.js');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes.js');

describe('slice 01 date contract', () => {
  it('accepts both ISO dates', () => {
    expect(analytics.parseDateRange({ start_date: '2024-01-01', end_date: '2024-01-31' })).toEqual({
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    });
  });

  it('accepts start_date only (end defaults to month end)', () => {
    const r = analytics.parseDateRange({ start_date: '2024-01-01' });
    expect(r.startDate).toBe('2024-01-01');
    expect(r.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts end_date only', () => {
    const r = analytics.parseDateRange({ end_date: '2024-01-31' });
    expect(r.endDate).toBe('2024-01-31');
  });

  it('omitted dates use current local month', () => {
    const r = analytics.parseDateRange({});
    expect(r.startDate <= r.endDate).toBe(true);
  });

  it('rejects invalid start_date', () => {
    expect(() => analytics.assertSlice01DateRange({ start_date: 'not-a-date' })).toThrow(AppError);
    try {
      analytics.assertSlice01DateRange({ start_date: '2024-13-40' });
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(err.field).toBe('start_date');
    }
  });

  it('rejects inverted range on KPIs/peaks after defaults applied', async () => {
    await expect(
      analytics.getKPIs({ start_date: '2024-12-31', end_date: '2024-01-01' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VAL_INVALID_DATE_RANGE, status: 400 });
  });
});
