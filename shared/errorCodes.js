// Centralized error codes shared by server and frontend.
// All API error responses use: { success: false, error: { code, message, details } }

const ERROR_CODES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_ACCOUNT_INACTIVE: 'AUTH_ACCOUNT_INACTIVE',
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_NO_PERMISSION: 'AUTH_NO_PERMISSION',

  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Resource
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  RESOURCE_IN_USE: 'RESOURCE_IN_USE',

  // Roles / users
  ROLE_IS_SYSTEM: 'ROLE_IS_SYSTEM',
  USERNAME_TAKEN: 'USERNAME_TAKEN',

  // Business rule violations
  BIZ_INSUFFICIENT_STOCK: 'BIZ_INSUFFICIENT_STOCK',
  BIZ_STOCK_COUNT_IN_PROGRESS: 'BIZ_STOCK_COUNT_IN_PROGRESS',
  BIZ_INVALID_STATE: 'BIZ_INVALID_STATE',
  BIZ_PAYMENT_EXCEEDS_BALANCE: 'BIZ_PAYMENT_EXCEEDS_BALANCE',
  BIZ_RECEIVE_EXCEEDS_ORDER: 'BIZ_RECEIVE_EXCEEDS_ORDER',
  BIZ_CREDIT_LIMIT_EXCEEDED: 'BIZ_CREDIT_LIMIT_EXCEEDED',
  BIZ_OUTSTANDING_BALANCE: 'BIZ_OUTSTANDING_BALANCE',

  // Phase 6 — POS / Invoices
  BIZ_INVOICE_LOCKED: 'BIZ_INVOICE_LOCKED',
  BIZ_INVALID_PAYMENT_TOTAL: 'BIZ_INVALID_PAYMENT_TOTAL',
  BIZ_GUEST_NO_CREDIT: 'BIZ_GUEST_NO_CREDIT',
  BIZ_INVOICE_EMPTY: 'BIZ_INVOICE_EMPTY',
  BIZ_EDIT_REQUEST_REQUIRED: 'BIZ_EDIT_REQUEST_REQUIRED',
  BIZ_EDIT_REQUEST_ALREADY_REVIEWED: 'BIZ_EDIT_REQUEST_ALREADY_REVIEWED',

  // Phase 8 — Warranties
  BIZ_WARRANTY_EXPIRED: 'BIZ_WARRANTY_EXPIRED',
  BIZ_WARRANTY_VOID: 'BIZ_WARRANTY_VOID',
  BIZ_WARRANTY_NOT_ACTIVE: 'BIZ_WARRANTY_NOT_ACTIVE',
  BIZ_DUPLICATE_SERIAL: 'BIZ_DUPLICATE_SERIAL',
  BIZ_SERIAL_REQUIRED: 'BIZ_SERIAL_REQUIRED',
  BIZ_CLAIM_ALREADY_RESOLVED: 'BIZ_CLAIM_ALREADY_RESOLVED',

  // Phase 9 — Returns
  BIZ_RETURN_QTY_EXCEEDED: 'BIZ_RETURN_QTY_EXCEEDED',
  BIZ_RETURN_ALREADY_EXISTS: 'BIZ_RETURN_ALREADY_EXISTS',
  BIZ_INVOICE_CANCELLED: 'BIZ_INVOICE_CANCELLED',
  BIZ_RETURN_NOT_PENDING: 'BIZ_RETURN_NOT_PENDING',
  BIZ_RETURN_NOTE_TOO_SHORT: 'BIZ_RETURN_NOTE_TOO_SHORT',
  BIZ_NO_INVOICE_NEEDS_APPROVAL: 'BIZ_NO_INVOICE_NEEDS_APPROVAL',
  BIZ_REFUND_PLAN_MISMATCH: 'BIZ_REFUND_PLAN_MISMATCH',

  // Phase 10 — Treasury
  BIZ_INSUFFICIENT_CASH: 'BIZ_INSUFFICIENT_CASH',
  BIZ_INSUFFICIENT_BANK_BALANCE: 'BIZ_INSUFFICIENT_BANK_BALANCE',
  BIZ_DRAWER_CLOSED: 'BIZ_DRAWER_CLOSED',
  BIZ_DRAWER_ALREADY_OPEN: 'BIZ_DRAWER_ALREADY_OPEN',
  BIZ_DISCREPANCY_NEEDS_APPROVAL: 'BIZ_DISCREPANCY_NEEDS_APPROVAL',
  BIZ_TRANSFER_SAME_ACCOUNT: 'BIZ_TRANSFER_SAME_ACCOUNT',
  BIZ_BANK_HAS_BALANCE: 'BIZ_BANK_HAS_BALANCE',
  BIZ_NO_DEFAULT_BANK: 'BIZ_NO_DEFAULT_BANK',

  // Phase 12 — Bills & Expenses
  BIZ_BILL_NOT_DUE: 'BIZ_BILL_NOT_DUE',
  BIZ_BILL_ALREADY_PAID: 'BIZ_BILL_ALREADY_PAID',
  BIZ_BILL_PAUSED: 'BIZ_BILL_PAUSED',
  BIZ_BILL_CANCELLED: 'BIZ_BILL_CANCELLED',
  BIZ_CATEGORY_IN_USE: 'BIZ_CATEGORY_IN_USE',
  BIZ_EXPENSE_LOCKED: 'BIZ_EXPENSE_LOCKED',
  BIZ_AMOUNT_REQUIRED: 'BIZ_AMOUNT_REQUIRED',

  // Phase 11 — Attendance & Leaves
  BIZ_CORRECTION_TOO_OLD: 'BIZ_CORRECTION_TOO_OLD',
  BIZ_INSUFFICIENT_LEAVE_BALANCE: 'BIZ_INSUFFICIENT_LEAVE_BALANCE',
  BIZ_LEAVE_OVERLAP: 'BIZ_LEAVE_OVERLAP',
  BIZ_LEAVE_INVALID_RANGE: 'BIZ_LEAVE_INVALID_RANGE',
  BIZ_LEAVE_NOT_PENDING: 'BIZ_LEAVE_NOT_PENDING',
  BIZ_ATTENDANCE_LOCKED: 'BIZ_ATTENDANCE_LOCKED',
  BIZ_HOLIDAY_DUPLICATE: 'BIZ_HOLIDAY_DUPLICATE',

  // Field validations
  VAL_DUPLICATE_PHONE: 'VAL_DUPLICATE_PHONE',
  VAL_INVALID_TRN: 'VAL_INVALID_TRN',

  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
};

const ERROR_MESSAGES = {
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 'Invalid username or password.',
  [ERROR_CODES.AUTH_ACCOUNT_LOCKED]:
    'Account temporarily locked after too many failed attempts. Try again later.',
  [ERROR_CODES.AUTH_ACCOUNT_INACTIVE]: 'This account is inactive.',
  [ERROR_CODES.AUTH_TOKEN_MISSING]: 'Authentication token missing.',
  [ERROR_CODES.AUTH_SESSION_EXPIRED]: 'Your session has expired. Please log in again.',
  [ERROR_CODES.AUTH_TOKEN_INVALID]: 'Invalid authentication token.',
  [ERROR_CODES.AUTH_NO_PERMISSION]: 'You do not have permission to perform this action.',
  [ERROR_CODES.VALIDATION_FAILED]: 'The submitted data is invalid.',
  [ERROR_CODES.RESOURCE_NOT_FOUND]: 'The requested resource was not found.',
  [ERROR_CODES.RESOURCE_CONFLICT]: 'A resource with these details already exists.',
  [ERROR_CODES.RESOURCE_IN_USE]: 'This resource is still in use and cannot be removed.',
  [ERROR_CODES.ROLE_IS_SYSTEM]: 'System roles cannot be modified or deleted.',
  [ERROR_CODES.USERNAME_TAKEN]: 'This username is already taken.',
  [ERROR_CODES.BIZ_INSUFFICIENT_STOCK]:
    'Not enough stock available for this operation.',
  [ERROR_CODES.BIZ_STOCK_COUNT_IN_PROGRESS]:
    'A stock count is in progress for this product. Try again once it is approved or rejected.',
  [ERROR_CODES.BIZ_INVALID_STATE]: 'This action is not allowed in the current state.',
  [ERROR_CODES.BIZ_PAYMENT_EXCEEDS_BALANCE]:
    'Payment amount cannot exceed the outstanding balance.',
  [ERROR_CODES.BIZ_RECEIVE_EXCEEDS_ORDER]:
    'Received quantity cannot exceed the ordered quantity.',
  [ERROR_CODES.BIZ_CREDIT_LIMIT_EXCEEDED]:
    'This sale would exceed the customer credit limit.',
  [ERROR_CODES.BIZ_OUTSTANDING_BALANCE]:
    'This customer still has an outstanding balance.',
  [ERROR_CODES.BIZ_INVOICE_LOCKED]:
    'This invoice can no longer be edited.',
  [ERROR_CODES.BIZ_INVALID_PAYMENT_TOTAL]:
    'Payment total does not match the invoice total.',
  [ERROR_CODES.BIZ_GUEST_NO_CREDIT]:
    'Credit payments require a registered customer.',
  [ERROR_CODES.BIZ_INVOICE_EMPTY]:
    'Cannot confirm an empty invoice.',
  [ERROR_CODES.BIZ_EDIT_REQUEST_REQUIRED]:
    'You need a manager-approved edit request to change this invoice.',
  [ERROR_CODES.BIZ_EDIT_REQUEST_ALREADY_REVIEWED]:
    'This edit request has already been reviewed.',
  [ERROR_CODES.VAL_DUPLICATE_PHONE]:
    'A customer with this phone number already exists.',
  [ERROR_CODES.VAL_INVALID_TRN]:
    'TRN must be exactly 15 digits.',
  [ERROR_CODES.BIZ_WARRANTY_EXPIRED]:
    'This warranty has expired and can no longer be claimed.',
  [ERROR_CODES.BIZ_WARRANTY_VOID]:
    'This warranty has been voided.',
  [ERROR_CODES.BIZ_WARRANTY_NOT_ACTIVE]:
    'This warranty is not active.',
  [ERROR_CODES.BIZ_DUPLICATE_SERIAL]:
    'A different active warranty already exists for this serial number.',
  [ERROR_CODES.BIZ_SERIAL_REQUIRED]:
    'A serial number is required for this product.',
  [ERROR_CODES.BIZ_CLAIM_ALREADY_RESOLVED]:
    'This claim has already been resolved.',
  [ERROR_CODES.BIZ_RETURN_QTY_EXCEEDED]:
    'Return quantity exceeds the originally sold quantity.',
  [ERROR_CODES.BIZ_RETURN_ALREADY_EXISTS]:
    'A pending or approved return already covers this item.',
  [ERROR_CODES.BIZ_INVOICE_CANCELLED]:
    'Cannot create a return against a cancelled invoice.',
  [ERROR_CODES.BIZ_RETURN_NOT_PENDING]:
    'This return request is no longer pending and cannot be modified.',
  [ERROR_CODES.BIZ_RETURN_NOTE_TOO_SHORT]:
    'Please describe the reason in detail (at least 10 characters).',
  [ERROR_CODES.BIZ_NO_INVOICE_NEEDS_APPROVAL]:
    'No-invoice returns require manager approval to be filed.',
  [ERROR_CODES.BIZ_REFUND_PLAN_MISMATCH]:
    'The refund payments do not match the total being returned.',
  [ERROR_CODES.BIZ_INSUFFICIENT_CASH]:
    'Not enough cash in the drawer for this transaction.',
  [ERROR_CODES.BIZ_INSUFFICIENT_BANK_BALANCE]:
    'Bank account does not have enough balance for this transaction.',
  [ERROR_CODES.BIZ_DRAWER_CLOSED]:
    'Cash drawer is closed. Open the drawer before recording cash transactions.',
  [ERROR_CODES.BIZ_DRAWER_ALREADY_OPEN]:
    'Cash drawer is already open. Close the current session first.',
  [ERROR_CODES.BIZ_DISCREPANCY_NEEDS_APPROVAL]:
    'Cash discrepancy exceeds the tolerance. Manager approval is required.',
  [ERROR_CODES.BIZ_TRANSFER_SAME_ACCOUNT]:
    'Cannot transfer to the same account.',
  [ERROR_CODES.BIZ_BANK_HAS_BALANCE]:
    'Cannot deactivate a bank account that still has a balance.',
  [ERROR_CODES.BIZ_NO_DEFAULT_BANK]:
    'No default bank account is configured.',
  [ERROR_CODES.BIZ_CORRECTION_TOO_OLD]:
    'Attendance corrections are only allowed for the last 30 days.',
  [ERROR_CODES.BIZ_INSUFFICIENT_LEAVE_BALANCE]:
    'Not enough leave balance for the requested days.',
  [ERROR_CODES.BIZ_LEAVE_OVERLAP]:
    'This leave overlaps with another approved or pending leave.',
  [ERROR_CODES.BIZ_LEAVE_INVALID_RANGE]:
    'End date must be on or after the start date.',
  [ERROR_CODES.BIZ_LEAVE_NOT_PENDING]:
    'Only pending leave requests can be changed.',
  [ERROR_CODES.BIZ_ATTENDANCE_LOCKED]:
    'This attendance record is locked and cannot be modified.',
  [ERROR_CODES.BIZ_HOLIDAY_DUPLICATE]:
    'A holiday already exists for that date.',
  [ERROR_CODES.BIZ_BILL_NOT_DUE]:
    'This bill payment is not due yet.',
  [ERROR_CODES.BIZ_BILL_ALREADY_PAID]:
    'This bill payment has already been paid.',
  [ERROR_CODES.BIZ_BILL_PAUSED]:
    'This bill is paused — resume it before making changes.',
  [ERROR_CODES.BIZ_BILL_CANCELLED]:
    'This bill has been cancelled.',
  [ERROR_CODES.BIZ_CATEGORY_IN_USE]:
    'This category is linked to bills or expenses and cannot be deleted.',
  [ERROR_CODES.BIZ_EXPENSE_LOCKED]:
    'Expenses can only be deleted on the same day they were created.',
  [ERROR_CODES.BIZ_AMOUNT_REQUIRED]:
    'Variable-amount bills require the actual paid amount.',
  [ERROR_CODES.INTERNAL_ERROR]: 'Something went wrong on the server.',
  [ERROR_CODES.NETWORK_ERROR]: 'Network unavailable. Check your connection to the server.',
};

class AppError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message || ERROR_MESSAGES[code] || 'Error');
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { ERROR_CODES, ERROR_MESSAGES, AppError };
