import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveManualAttendanceStatus,
  assertRequestedStatusAllowed,
} = require('../../shared/attendancePolicy.js');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes.js');

describe('attendancePolicy', () => {
  it('derives present when on time with check-in only', () => {
    expect(
      resolveManualAttendanceStatus({
        requestedStatus: 'present',
        checkIn: '2026-01-02T09:00:00.000Z',
        checkOut: null,
        lateMinutes: 0,
      }),
    ).toBe('present');
  });

  it('derives late when lateMinutes > 0', () => {
    expect(
      resolveManualAttendanceStatus({
        checkIn: '2026-01-02T10:00:00.000Z',
        checkOut: null,
        lateMinutes: 20,
      }),
    ).toBe('late');
  });

  it('rejects client present when times imply absent', () => {
    expect(() =>
      assertRequestedStatusAllowed('present', 'absent'),
    ).toThrowError(AppError);
    try {
      assertRequestedStatusAllowed('present', 'absent');
    } catch (e) {
      expect(e.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  it('allows explicit leave', () => {
    expect(
      resolveManualAttendanceStatus({
        requestedStatus: 'leave',
        checkIn: null,
        checkOut: null,
      }),
    ).toBe('leave');
  });
});
