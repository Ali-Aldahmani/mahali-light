import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { storeDate, STORE_TIMEZONE } = require('../../server/utils/dates');

describe('storeDate (Asia/Dubai business day)', () => {
  it('defaults to Asia/Dubai', () => {
    expect(STORE_TIMEZONE).toBe('Asia/Dubai');
  });

  it('puts 00:00–04:00 Dubai on the Dubai day, not the UTC day', () => {
    // 01:30 on 1 Oct in Dubai is still 30 Sep in UTC — the old
    // toISOString().slice(0, 10) booked this into September.
    expect(storeDate(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10-01');
    expect(storeDate(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
    expect(storeDate(new Date('2026-12-31T19:59:59Z'))).toBe('2026-12-31');
  });

  it('keeps DATE values parsed as local midnight on their own day', () => {
    // pg parses DATE as local midnight of the process timezone.
    expect(storeDate(new Date(2026, 8, 23))).toBe('2026-09-23');
  });

  it('passes calendar-day strings through and rejects invalid dates', () => {
    expect(storeDate('2026-09-23')).toBe('2026-09-23');
    expect(storeDate('2026-09-23T10:00:00')).toBe('2026-09-23');
    expect(storeDate(new Date('garbage'))).toBeNull();
  });

  it('returns today for empty input', () => {
    expect(storeDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(storeDate(null)).toBe(storeDate(new Date()));
  });
});
