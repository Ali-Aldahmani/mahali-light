import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canSubmitCorrectionFor } = require('../../server/controllers/attendanceController.js');

describe('canSubmitCorrectionFor', () => {
  it('allows attendance.view_all for any employee record', () => {
    const user = { employee_id: 'emp-1', permissions: ['attendance.view_all'] };
    expect(canSubmitCorrectionFor(user, 'emp-2')).toBe(true);
  });

  it('allows wildcard admins for any employee record', () => {
    const user = { employee_id: 'emp-1', permissions: ['*'] };
    expect(canSubmitCorrectionFor(user, 'emp-2')).toBe(true);
  });

  it('allows correction_request users only for their own attendance', () => {
    const user = {
      employee_id: 'emp-1',
      permissions: ['attendance.correction_request', 'attendance.view_own'],
    };
    expect(canSubmitCorrectionFor(user, 'emp-1')).toBe(true);
    expect(canSubmitCorrectionFor(user, 'emp-2')).toBe(false);
  });

  it('denies when employee_id is missing', () => {
    const user = { permissions: ['attendance.correction_request'] };
    expect(canSubmitCorrectionFor(user, 'emp-1')).toBe(false);
  });
});
