// Centralized error codes shared by server and frontend.
// API shape: { success: false, error: { code, message, details, field? } }

const ERROR_CODES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_ACCOUNT_INACTIVE: 'AUTH_ACCOUNT_INACTIVE',
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_NO_PERMISSION: 'AUTH_NO_PERMISSION',
  AUTH_FORCE_LOGGED_OUT: 'AUTH_FORCE_LOGGED_OUT',

  // Validation (generic + field-level)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VAL_REQUIRED_FIELD: 'VAL_REQUIRED_FIELD',
  VAL_INVALID_FORMAT: 'VAL_INVALID_FORMAT',
  VAL_DUPLICATE_SKU: 'VAL_DUPLICATE_SKU',
  VAL_DUPLICATE_BARCODE: 'VAL_DUPLICATE_BARCODE',
  VAL_DUPLICATE_PHONE: 'VAL_DUPLICATE_PHONE',
  VAL_INVALID_DATE_RANGE: 'VAL_INVALID_DATE_RANGE',
  VAL_NEGATIVE_AMOUNT: 'VAL_NEGATIVE_AMOUNT',
  VAL_INVALID_QUANTITY: 'VAL_INVALID_QUANTITY',
  VAL_MAX_EXCEEDED: 'VAL_MAX_EXCEEDED',
  VAL_INVALID_EMAIL: 'VAL_INVALID_EMAIL',
  VAL_INVALID_TRN: 'VAL_INVALID_TRN',

  // Resource
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  RESOURCE_IN_USE: 'RESOURCE_IN_USE',

  // Roles / users
  ROLE_IS_SYSTEM: 'ROLE_IS_SYSTEM',
  USERNAME_TAKEN: 'USERNAME_TAKEN',

  // Business
  BIZ_INSUFFICIENT_STOCK: 'BIZ_INSUFFICIENT_STOCK',
  BIZ_STOCK_COUNT_IN_PROGRESS: 'BIZ_STOCK_COUNT_IN_PROGRESS',
  BIZ_INVALID_STATE: 'BIZ_INVALID_STATE',
  BIZ_PAYMENT_EXCEEDS_BALANCE: 'BIZ_PAYMENT_EXCEEDS_BALANCE',
  BIZ_RECEIVE_EXCEEDS_ORDER: 'BIZ_RECEIVE_EXCEEDS_ORDER',
  BIZ_CREDIT_LIMIT_EXCEEDED: 'BIZ_CREDIT_LIMIT_EXCEEDED',
  BIZ_OUTSTANDING_BALANCE: 'BIZ_OUTSTANDING_BALANCE',
  BIZ_INVOICE_LOCKED: 'BIZ_INVOICE_LOCKED',
  BIZ_INVOICE_ALREADY_PAID: 'BIZ_INVOICE_ALREADY_PAID',
  BIZ_INVALID_PAYMENT_TOTAL: 'BIZ_INVALID_PAYMENT_TOTAL',
  BIZ_GUEST_NO_CREDIT: 'BIZ_GUEST_NO_CREDIT',
  BIZ_INVOICE_EMPTY: 'BIZ_INVOICE_EMPTY',
  BIZ_EDIT_REQUEST_REQUIRED: 'BIZ_EDIT_REQUEST_REQUIRED',
  BIZ_EDIT_REQUEST_ALREADY_REVIEWED: 'BIZ_EDIT_REQUEST_ALREADY_REVIEWED',
  BIZ_WARRANTY_EXPIRED: 'BIZ_WARRANTY_EXPIRED',
  BIZ_WARRANTY_VOID: 'BIZ_WARRANTY_VOID',
  BIZ_WARRANTY_NOT_ACTIVE: 'BIZ_WARRANTY_NOT_ACTIVE',
  BIZ_DUPLICATE_SERIAL: 'BIZ_DUPLICATE_SERIAL',
  BIZ_SERIAL_REQUIRED: 'BIZ_SERIAL_REQUIRED',
  BIZ_CLAIM_ALREADY_RESOLVED: 'BIZ_CLAIM_ALREADY_RESOLVED',
  BIZ_RETURN_QTY_EXCEEDED: 'BIZ_RETURN_QTY_EXCEEDED',
  BIZ_RETURN_ALREADY_EXISTS: 'BIZ_RETURN_ALREADY_EXISTS',
  BIZ_INVOICE_CANCELLED: 'BIZ_INVOICE_CANCELLED',
  BIZ_RETURN_NOT_PENDING: 'BIZ_RETURN_NOT_PENDING',
  BIZ_RETURN_NOTE_TOO_SHORT: 'BIZ_RETURN_NOTE_TOO_SHORT',
  BIZ_NO_INVOICE_NEEDS_APPROVAL: 'BIZ_NO_INVOICE_NEEDS_APPROVAL',
  BIZ_REFUND_PLAN_MISMATCH: 'BIZ_REFUND_PLAN_MISMATCH',
  BIZ_INSUFFICIENT_CASH: 'BIZ_INSUFFICIENT_CASH',
  BIZ_INSUFFICIENT_BANK_BALANCE: 'BIZ_INSUFFICIENT_BANK_BALANCE',
  BIZ_DRAWER_CLOSED: 'BIZ_DRAWER_CLOSED',
  BIZ_DRAWER_ALREADY_OPEN: 'BIZ_DRAWER_ALREADY_OPEN',
  BIZ_DISCREPANCY_NEEDS_APPROVAL: 'BIZ_DISCREPANCY_NEEDS_APPROVAL',
  BIZ_TRANSFER_SAME_ACCOUNT: 'BIZ_TRANSFER_SAME_ACCOUNT',
  BIZ_BANK_HAS_BALANCE: 'BIZ_BANK_HAS_BALANCE',
  BIZ_NO_DEFAULT_BANK: 'BIZ_NO_DEFAULT_BANK',
  BIZ_JOURNAL_UNBALANCED: 'BIZ_JOURNAL_UNBALANCED',
  BIZ_JOURNAL_IMMUTABLE: 'BIZ_JOURNAL_IMMUTABLE',
  BIZ_PERIOD_CLOSED: 'BIZ_PERIOD_CLOSED',
  BIZ_PERIOD_NOT_FOUND: 'BIZ_PERIOD_NOT_FOUND',
  BIZ_ACCOUNT_SYSTEM: 'BIZ_ACCOUNT_SYSTEM',
  BIZ_ACCOUNT_IN_USE: 'BIZ_ACCOUNT_IN_USE',
  BIZ_ACCOUNT_NOT_FOUND: 'BIZ_ACCOUNT_NOT_FOUND',
  BIZ_BILL_NOT_DUE: 'BIZ_BILL_NOT_DUE',
  BIZ_BILL_ALREADY_PAID: 'BIZ_BILL_ALREADY_PAID',
  BIZ_BILL_PAUSED: 'BIZ_BILL_PAUSED',
  BIZ_BILL_CANCELLED: 'BIZ_BILL_CANCELLED',
  BIZ_CATEGORY_IN_USE: 'BIZ_CATEGORY_IN_USE',
  BIZ_EXPENSE_LOCKED: 'BIZ_EXPENSE_LOCKED',
  BIZ_AMOUNT_REQUIRED: 'BIZ_AMOUNT_REQUIRED',
  BIZ_BACKUP_IN_PROGRESS: 'BIZ_BACKUP_IN_PROGRESS',
  BIZ_BACKUP_FILE_MISSING: 'BIZ_BACKUP_FILE_MISSING',
  BIZ_BACKUP_RESTORE_BLOCKED: 'BIZ_BACKUP_RESTORE_BLOCKED',
  BIZ_MAINTENANCE_MODE: 'BIZ_MAINTENANCE_MODE',
  BIZ_NAS_CONNECTION_FAILED: 'BIZ_NAS_CONNECTION_FAILED',
  BIZ_CORRECTION_TOO_OLD: 'BIZ_CORRECTION_TOO_OLD',
  BIZ_INSUFFICIENT_LEAVE_BALANCE: 'BIZ_INSUFFICIENT_LEAVE_BALANCE',
  BIZ_LEAVE_OVERLAP: 'BIZ_LEAVE_OVERLAP',
  BIZ_LEAVE_INVALID_RANGE: 'BIZ_LEAVE_INVALID_RANGE',
  BIZ_LEAVE_NOT_PENDING: 'BIZ_LEAVE_NOT_PENDING',
  BIZ_ATTENDANCE_LOCKED: 'BIZ_ATTENDANCE_LOCKED',
  BIZ_HOLIDAY_DUPLICATE: 'BIZ_HOLIDAY_DUPLICATE',
  BIZ_DUPLICATE_ATTENDANCE: 'BIZ_DUPLICATE_ATTENDANCE',
  BIZ_SUPPLIER_HAS_POS: 'BIZ_SUPPLIER_HAS_POS',
  BIZ_CATEGORY_HAS_PRODUCTS: 'BIZ_CATEGORY_HAS_PRODUCTS',

  // Database
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  DB_CONSTRAINT_VIOLATION: 'DB_CONSTRAINT_VIOLATION',
  DB_TRANSACTION_FAILED: 'DB_TRANSACTION_FAILED',

  // Files
  FILE_UPLOAD_FAILED: 'FILE_UPLOAD_FAILED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_INVALID_TYPE: 'FILE_INVALID_TYPE',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_DISK_FULL: 'FILE_DISK_FULL',

  // System
  SYS_SERVER_UNREACHABLE: 'SYS_SERVER_UNREACHABLE',
  SYS_NAS_UNREACHABLE: 'SYS_NAS_UNREACHABLE',
  SYS_PRINTER_OFFLINE: 'SYS_PRINTER_OFFLINE',
  SYS_BACKUP_FAILED: 'SYS_BACKUP_FAILED',
  SYS_DISK_LOW: 'SYS_DISK_LOW',
  SYS_RESTORE_IN_PROGRESS: 'SYS_RESTORE_IN_PROGRESS',

  // Generic (legacy)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
};

/** @type {Record<string, { message: string, status: number, severity: string }>} */
const ERROR_DEFS = {
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: {
    message: 'Username or password is incorrect.',
    status: 401,
    severity: 'warning',
  },
  [ERROR_CODES.AUTH_SESSION_EXPIRED]: {
    message: 'Your session has expired. Please log in again.',
    status: 401,
    severity: 'info',
  },
  [ERROR_CODES.AUTH_TOKEN_MISSING]: {
    message: 'Authentication token missing.',
    status: 401,
    severity: 'info',
  },
  [ERROR_CODES.AUTH_TOKEN_INVALID]: {
    message: 'Invalid authentication token.',
    status: 401,
    severity: 'info',
  },
  [ERROR_CODES.AUTH_NO_PERMISSION]: {
    message: "You don't have permission to perform this action.",
    status: 403,
    severity: 'warning',
  },
  [ERROR_CODES.AUTH_ACCOUNT_LOCKED]: {
    message:
      'Account locked after too many failed attempts. Try again in 15 minutes.',
    status: 403,
    severity: 'warning',
  },
  [ERROR_CODES.AUTH_ACCOUNT_INACTIVE]: {
    message: 'This account has been deactivated.',
    status: 403,
    severity: 'warning',
  },
  [ERROR_CODES.AUTH_FORCE_LOGGED_OUT]: {
    message: 'You have been logged out by an administrator.',
    status: 401,
    severity: 'info',
  },
  [ERROR_CODES.VALIDATION_FAILED]: {
    message: 'The submitted data is invalid.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_REQUIRED_FIELD]: {
    message: 'This field is required.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_INVALID_FORMAT]: {
    message: 'Invalid format.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_DUPLICATE_SKU]: {
    message: 'This SKU already exists.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_DUPLICATE_BARCODE]: {
    message: 'This barcode already exists.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_DUPLICATE_PHONE]: {
    message: 'This phone number is already registered.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_INVALID_DATE_RANGE]: {
    message: 'End date must be after start date.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_NEGATIVE_AMOUNT]: {
    message: 'Amount cannot be negative.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_INVALID_QUANTITY]: {
    message: 'Quantity must be greater than 0.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_MAX_EXCEEDED]: {
    message: 'Value exceeds maximum allowed.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_INVALID_EMAIL]: {
    message: 'Invalid email address.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.VAL_INVALID_TRN]: {
    message: 'TRN must be exactly 15 digits.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.RESOURCE_NOT_FOUND]: {
    message: 'The requested resource was not found.',
    status: 404,
    severity: 'info',
  },
  [ERROR_CODES.RESOURCE_CONFLICT]: {
    message: 'A resource with these details already exists.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.RESOURCE_IN_USE]: {
    message: 'This resource is still in use and cannot be removed.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.ROLE_IS_SYSTEM]: {
    message: 'System roles cannot be modified or deleted.',
    status: 403,
    severity: 'warning',
  },
  [ERROR_CODES.USERNAME_TAKEN]: {
    message: 'This username is already taken.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_INSUFFICIENT_STOCK]: {
    message:
      'Insufficient stock for {product}. Available: {available}, Requested: {requested}.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_INVOICE_ALREADY_PAID]: {
    message: 'This invoice is already fully paid.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_INVOICE_CANCELLED]: {
    message: 'Cannot modify a cancelled invoice.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_PERIOD_CLOSED]: {
    message: 'This financial period is closed. No changes can be made.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_WARRANTY_EXPIRED]: {
    message: 'This warranty has expired.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_WARRANTY_VOID]: {
    message: 'This warranty has been voided.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_RETURN_QTY_EXCEEDED]: {
    message: 'Return quantity exceeds original purchase quantity.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_RETURN_ALREADY_EXISTS]: {
    message: 'A return request already exists for this item.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_DUPLICATE_ATTENDANCE]: {
    message: 'Attendance already recorded for this employee today.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_LEAVE_OVERLAP]: {
    message: 'Leave dates overlap with an existing approved leave.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_INSUFFICIENT_LEAVE_BALANCE]: {
    message:
      'Insufficient leave balance. Available: {available} days, Requested: {requested} days.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_CREDIT_LIMIT_EXCEEDED]: {
    message: "This exceeds the customer's credit limit of {limit} AED.",
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_PAYMENT_EXCEEDS_BALANCE]: {
    message: 'Payment amount exceeds outstanding balance.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_INSUFFICIENT_CASH]: {
    message: 'Insufficient cash in drawer. Available: {available} AED.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_STOCK_COUNT_IN_PROGRESS]: {
    message: 'A stock count is in progress for this product.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_CORRECTION_TOO_OLD]: {
    message:
      'Attendance corrections can only be made for the last 30 days.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_BACKUP_IN_PROGRESS]: {
    message: 'A backup is already running. Please wait for it to complete.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_JOURNAL_UNBALANCED]: {
    message: 'Journal entry is not balanced. Debits must equal credits.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_JOURNAL_IMMUTABLE]: {
    message: 'Journal entries cannot be modified after posting.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_SUPPLIER_HAS_POS]: {
    message: 'Cannot delete supplier with existing purchase orders.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_CATEGORY_HAS_PRODUCTS]: {
    message: 'Cannot delete category with existing products.',
    status: 422,
    severity: 'warning',
  },
  [ERROR_CODES.BIZ_MAINTENANCE_MODE]: {
    message: 'System restore is in progress. Please try again shortly.',
    status: 503,
    severity: 'critical',
  },
  [ERROR_CODES.DB_CONNECTION_FAILED]: {
    message:
      'Database connection failed. Please contact your administrator.',
    status: 500,
    severity: 'critical',
  },
  [ERROR_CODES.DB_QUERY_FAILED]: {
    message: 'A database error occurred. Please try again.',
    status: 500,
    severity: 'error',
  },
  [ERROR_CODES.DB_CONSTRAINT_VIOLATION]: {
    message: 'This operation violates a data constraint.',
    status: 409,
    severity: 'warning',
  },
  [ERROR_CODES.DB_TRANSACTION_FAILED]: {
    message: 'Transaction failed and was rolled back.',
    status: 500,
    severity: 'error',
  },
  [ERROR_CODES.FILE_UPLOAD_FAILED]: {
    message: 'File upload failed. Please try again.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.FILE_TOO_LARGE]: {
    message: 'File size exceeds the maximum allowed size.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.FILE_INVALID_TYPE]: {
    message: 'Invalid file type. Allowed: {allowed}.',
    status: 400,
    severity: 'warning',
  },
  [ERROR_CODES.FILE_NOT_FOUND]: {
    message: 'File not found.',
    status: 404,
    severity: 'info',
  },
  [ERROR_CODES.FILE_DISK_FULL]: {
    message: 'Server disk is full. Please contact administrator.',
    status: 507,
    severity: 'critical',
  },
  [ERROR_CODES.SYS_SERVER_UNREACHABLE]: {
    message: 'Cannot connect to server. Working in offline mode.',
    status: 503,
    severity: 'warning',
  },
  [ERROR_CODES.SYS_NAS_UNREACHABLE]: {
    message: 'NAS storage is unreachable. Backup saved locally only.',
    status: 503,
    severity: 'warning',
  },
  [ERROR_CODES.SYS_PRINTER_OFFLINE]: {
    message: 'Printer is offline or unavailable.',
    status: 503,
    severity: 'warning',
  },
  [ERROR_CODES.SYS_BACKUP_FAILED]: {
    message: 'Backup failed. Please check backup settings.',
    status: 500,
    severity: 'critical',
  },
  [ERROR_CODES.SYS_DISK_LOW]: {
    message: 'Server disk space is running low.',
    status: 503,
    severity: 'warning',
  },
  [ERROR_CODES.SYS_RESTORE_IN_PROGRESS]: {
    message: 'System restore is in progress.',
    status: 503,
    severity: 'critical',
  },
  [ERROR_CODES.INTERNAL_ERROR]: {
    message: 'Something went wrong on the server.',
    status: 500,
    severity: 'error',
  },
  [ERROR_CODES.NETWORK_ERROR]: {
    message: 'Network unavailable. Check your connection to the server.',
    status: 0,
    severity: 'warning',
  },
};

// Legacy messages for codes not yet in ERROR_DEFS (phases 6–17 detail).
const LEGACY_MESSAGES = {
  [ERROR_CODES.BIZ_INVALID_STATE]: 'This action is not allowed in the current state.',
  [ERROR_CODES.BIZ_RECEIVE_EXCEEDS_ORDER]:
    'Received quantity cannot exceed the ordered quantity.',
  [ERROR_CODES.BIZ_OUTSTANDING_BALANCE]: 'This customer still has an outstanding balance.',
  [ERROR_CODES.BIZ_INVOICE_LOCKED]: 'This invoice can no longer be edited.',
  [ERROR_CODES.BIZ_INVALID_PAYMENT_TOTAL]: 'Payment total does not match the invoice total.',
  [ERROR_CODES.BIZ_GUEST_NO_CREDIT]: 'Credit payments require a registered customer.',
  [ERROR_CODES.BIZ_INVOICE_EMPTY]: 'Cannot confirm an empty invoice.',
  [ERROR_CODES.BIZ_EDIT_REQUEST_REQUIRED]:
    'You need a manager-approved edit request to change this invoice.',
  [ERROR_CODES.BIZ_EDIT_REQUEST_ALREADY_REVIEWED]:
    'This edit request has already been reviewed.',
  [ERROR_CODES.BIZ_WARRANTY_NOT_ACTIVE]: 'This warranty is not active.',
  [ERROR_CODES.BIZ_DUPLICATE_SERIAL]:
    'A different active warranty already exists for this serial number.',
  [ERROR_CODES.BIZ_SERIAL_REQUIRED]: 'A serial number is required for this product.',
  [ERROR_CODES.BIZ_CLAIM_ALREADY_RESOLVED]: 'This claim has already been resolved.',
  [ERROR_CODES.BIZ_RETURN_NOT_PENDING]:
    'This return request is no longer pending and cannot be modified.',
  [ERROR_CODES.BIZ_RETURN_NOTE_TOO_SHORT]:
    'Please describe the reason in detail (at least 10 characters).',
  [ERROR_CODES.BIZ_NO_INVOICE_NEEDS_APPROVAL]:
    'No-invoice returns require manager approval to be filed.',
  [ERROR_CODES.BIZ_REFUND_PLAN_MISMATCH]:
    'The refund payments do not match the total being returned.',
  [ERROR_CODES.BIZ_INSUFFICIENT_BANK_BALANCE]:
    'Bank account does not have enough balance for this transaction.',
  [ERROR_CODES.BIZ_DRAWER_CLOSED]:
    'Cash drawer is closed. Open the drawer before recording cash transactions.',
  [ERROR_CODES.BIZ_DRAWER_ALREADY_OPEN]:
    'Cash drawer is already open. Close the current session first.',
  [ERROR_CODES.BIZ_DISCREPANCY_NEEDS_APPROVAL]:
    'Cash discrepancy exceeds the tolerance. Manager approval is required.',
  [ERROR_CODES.BIZ_TRANSFER_SAME_ACCOUNT]: 'Cannot transfer to the same account.',
  [ERROR_CODES.BIZ_BANK_HAS_BALANCE]:
    'Cannot deactivate a bank account that still has a balance.',
  [ERROR_CODES.BIZ_NO_DEFAULT_BANK]: 'No default bank account is configured.',
  [ERROR_CODES.BIZ_LEAVE_INVALID_RANGE]: 'End date must be on or after the start date.',
  [ERROR_CODES.BIZ_LEAVE_NOT_PENDING]: 'Only pending leave requests can be changed.',
  [ERROR_CODES.BIZ_ATTENDANCE_LOCKED]:
    'This attendance record is locked and cannot be modified.',
  [ERROR_CODES.BIZ_HOLIDAY_DUPLICATE]: 'A holiday already exists for that date.',
  [ERROR_CODES.BIZ_BILL_NOT_DUE]: 'This bill payment is not due yet.',
  [ERROR_CODES.BIZ_BILL_ALREADY_PAID]: 'This bill payment has already been paid.',
  [ERROR_CODES.BIZ_BILL_PAUSED]: 'This bill is paused — resume it before making changes.',
  [ERROR_CODES.BIZ_BILL_CANCELLED]: 'This bill has been cancelled.',
  [ERROR_CODES.BIZ_CATEGORY_IN_USE]:
    'This category is linked to bills or expenses and cannot be deleted.',
  [ERROR_CODES.BIZ_EXPENSE_LOCKED]:
    'Expenses can only be deleted on the same day they were created.',
  [ERROR_CODES.BIZ_AMOUNT_REQUIRED]: 'Variable-amount bills require the actual paid amount.',
  [ERROR_CODES.BIZ_PERIOD_NOT_FOUND]: 'No financial period exists for this date.',
  [ERROR_CODES.BIZ_ACCOUNT_SYSTEM]: 'System accounts cannot be modified or deleted.',
  [ERROR_CODES.BIZ_ACCOUNT_IN_USE]:
    'This account is referenced by journal entries and cannot be deleted.',
  [ERROR_CODES.BIZ_ACCOUNT_NOT_FOUND]: 'Chart of accounts entry not found.',
  [ERROR_CODES.BIZ_BACKUP_FILE_MISSING]: 'Backup file is not available.',
  [ERROR_CODES.BIZ_BACKUP_RESTORE_BLOCKED]: 'This backup cannot be restored.',
  [ERROR_CODES.BIZ_NAS_CONNECTION_FAILED]: 'Could not connect to NAS storage.',
};

const ERROR_MESSAGES = { ...LEGACY_MESSAGES };
for (const [code, def] of Object.entries(ERROR_DEFS)) {
  ERROR_MESSAGES[code] = def.message;
}

function interpolate(template, details) {
  if (!template || !details || typeof details !== 'object') return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = details[key];
    return v !== undefined && v !== null ? String(v) : `{${key}}`;
  });
}

function getErrorDef(code) {
  return ERROR_DEFS[code] || null;
}

function defaultStatusForCode(code) {
  if (!code) return 500;
  if (code.startsWith('AUTH_')) {
    return code === 'AUTH_NO_PERMISSION' || code === 'AUTH_ACCOUNT_LOCKED' ? 403 : 401;
  }
  if (code.startsWith('VAL_') || code === 'VALIDATION_FAILED') return 400;
  if (code.startsWith('BIZ_')) return 422;
  if (code.startsWith('DB_')) return 500;
  if (code.startsWith('FILE_')) return code === 'FILE_DISK_FULL' ? 507 : 400;
  if (code.startsWith('SYS_')) return 503;
  if (code === 'RESOURCE_NOT_FOUND') return 404;
  if (code === 'RESOURCE_CONFLICT') return 409;
  return 500;
}

function defaultSeverityForCode(code, status) {
  const def = getErrorDef(code);
  if (def?.severity) return def.severity;
  if (status >= 500) return 'error';
  if (status === 403 || status === 401) return 'warning';
  return 'info';
}

class AppError extends Error {
  /**
   * @param {string} code
   * @param {string|object|null} messageOrDetails - custom message OR details object
   * @param {{ status?: number, details?: object, field?: string, severity?: string }} [opts]
   */
  constructor(code, messageOrDetails, opts = {}) {
    let message;
    let details = null;
    let status;
    let field;
    let severity;

    if (
      messageOrDetails &&
      typeof messageOrDetails === 'object' &&
      !Array.isArray(messageOrDetails) &&
      !(messageOrDetails instanceof Error)
    ) {
      details = messageOrDetails;
      const def = getErrorDef(code);
      message = interpolate(def?.message || ERROR_MESSAGES[code] || 'Error', details);
      status = opts.status ?? def?.status ?? defaultStatusForCode(code);
    } else {
      details = opts.details ?? null;
      const def = getErrorDef(code);
      const base = messageOrDetails || def?.message || ERROR_MESSAGES[code] || 'Error';
      message =
        details && typeof details === 'object'
          ? interpolate(base, details)
          : base;
      status = opts.status ?? def?.status ?? defaultStatusForCode(code);
    }

    field = opts.field ?? null;
    severity = opts.severity ?? defaultSeverityForCode(code, status);

    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.field = field;
    this.severity = severity;
  }
}

module.exports = {
  ERROR_CODES,
  ERROR_MESSAGES,
  ERROR_DEFS,
  AppError,
  interpolate,
  getErrorDef,
  defaultStatusForCode,
  defaultSeverityForCode,
};
