import { describe, expect, it } from 'vitest';
import { samePhone, toE164 } from './phone';

describe('phone helpers', () => {
  it('reads every stored spelling of a UAE number', () => {
    for (const raw of ['+971501234567', '+971 50 123 4567', '00971501234567', '0501234567', '050-123-4567', '971501234567', '501234567']) {
      expect(toE164(raw)).toBe('+971501234567');
    }
  });
  it('keeps foreign international numbers and landlines', () => {
    expect(toE164('+44 7400 123456')).toBe('+447400123456');
    expect(toE164('04 123 4567')).toBe('+97141234567');
  });
  it('is empty for nothing', () => {
    expect(toE164('')).toBe('');
    expect(toE164(null)).toBe('');
    expect(toE164('  ')).toBe('');
  });
  it('matches the same number across formats', () => {
    expect(samePhone('050 123 4567', '+971501234567')).toBe(true);
    expect(samePhone('0501234567', '0501234568')).toBe(false);
    expect(samePhone('', '')).toBe(false);
  });
});
