import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  hasAnyApprovalPermission,
  allowedSections,
} = require('../../server/services/approvalsService.js');
const { requireAnyPermission } = require('../../server/middleware/permissions.js');
const { ERROR_CODES } = require('../../shared/errorCodes.js');

describe('approvals authorization', () => {
  it('hasAnyApprovalPermission is true for approvers and admins', () => {
    expect(hasAnyApprovalPermission(['return.approve'])).toBe(true);
    expect(hasAnyApprovalPermission(['*'])).toBe(true);
    expect(hasAnyApprovalPermission(['attendance.view_own'])).toBe(false);
  });

  it('allowedSections only opens sections the caller can approve', () => {
    expect(allowedSections(['return.approve'])).toEqual({
      returns: true,
      invoice_edits: false,
      stock_adjustments: false,
      stock_counts: false,
      attendance_corrections: false,
      leaves: false,
    });
  });

  it('requireAnyPermission allows one matching permission', () => {
    let ok = false;
    requireAnyPermission('return.approve', 'invoice.edit_approve')(
      { user: { permissions: ['return.approve'] } },
      {},
      () => {
        ok = true;
      },
    );
    expect(ok).toBe(true);
  });

  it('requireAnyPermission rejects users without any approval permission', () => {
    let err = null;
    requireAnyPermission('return.approve', 'invoice.edit_approve')(
      { user: { permissions: ['invoice.create'] } },
      {},
      (e) => {
        err = e;
      },
    );
    expect(err?.code).toBe(ERROR_CODES.AUTH_NO_PERMISSION);
  });
});
