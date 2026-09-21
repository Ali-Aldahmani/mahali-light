import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canViewLeave } = require('../../server/controllers/leavesController.js');

describe('canViewLeave', () => {
  const ownLeave = { employeeId: 'emp-1' };
  const otherLeave = { employeeId: 'emp-2' };

  it('allows attendance.view_all for any leave', () => {
    const user = { employee_id: 'emp-1', permissions: ['attendance.view_all'] };
    expect(canViewLeave(user, otherLeave)).toBe(true);
  });

  it('allows wildcard admins for any leave', () => {
    const user = { employee_id: 'emp-1', permissions: ['*'] };
    expect(canViewLeave(user, otherLeave)).toBe(true);
  });

  it('allows view_own only for the caller employee leave', () => {
    const user = { employee_id: 'emp-1', permissions: ['attendance.view_own'] };
    expect(canViewLeave(user, ownLeave)).toBe(true);
    expect(canViewLeave(user, otherLeave)).toBe(false);
  });

  it('denies view_own when employee_id is missing', () => {
    const user = { permissions: ['attendance.view_own'] };
    expect(canViewLeave(user, ownLeave)).toBe(false);
  });
});
