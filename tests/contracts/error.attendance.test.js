import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ERROR_CODES, ERROR_DEFS, AppError } = require('../../shared/errorCodes.js');
const attendanceRouter = require('../../server/routes/attendance.js');

describe('invoice / stock HTTP status taxonomy', () => {
  it('BIZ_INVALID_STATE is 409 (resource state conflict)', () => {
    expect(ERROR_DEFS[ERROR_CODES.BIZ_INVALID_STATE].status).toBe(409);
    expect(new AppError(ERROR_CODES.BIZ_INVALID_STATE).status).toBe(409);
  });

  it('BIZ_INVOICE_EMPTY and BIZ_INSUFFICIENT_STOCK are 422', () => {
    expect(ERROR_DEFS[ERROR_CODES.BIZ_INVOICE_EMPTY].status).toBe(422);
    expect(ERROR_DEFS[ERROR_CODES.BIZ_INSUFFICIENT_STOCK].status).toBe(422);
    expect(new AppError(ERROR_CODES.BIZ_INVOICE_EMPTY).status).toBe(422);
    expect(new AppError(ERROR_CODES.BIZ_INSUFFICIENT_STOCK).status).toBe(422);
  });

  it('BIZ_GUEST_NO_CREDIT is 422; locked/reviewed are 409', () => {
    expect(new AppError(ERROR_CODES.BIZ_GUEST_NO_CREDIT).status).toBe(422);
    expect(ERROR_DEFS[ERROR_CODES.BIZ_INVOICE_LOCKED].status).toBe(409);
    expect(ERROR_DEFS[ERROR_CODES.BIZ_EDIT_REQUEST_ALREADY_REVIEWED].status).toBe(409);
  });
});

describe('attendance self-or-all uses AppError pipeline', () => {
  it('denies with AUTH_NO_PERMISSION via next()', () => {
    let err;
    attendanceRouter.selfOrViewAll(
      {
        user: { permissions: ['attendance.view_own'], employee_id: 'emp-a' },
        params: { employeeId: 'emp-b' },
      },
      (e) => {
        err = e;
      },
      () => {},
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
    expect(err.status).toBe(403);
    expect(err.details.employeeId).toBe('emp-b');
  });

  it('allows view_all without matching employee id', () => {
    let proceeded = false;
    attendanceRouter.selfOrViewAll(
      {
        user: { permissions: ['attendance.view_all'], employee_id: null },
        params: { employeeId: 'emp-z' },
      },
      () => {},
      () => {
        proceeded = true;
      },
    );
    expect(proceeded).toBe(true);
  });
});
