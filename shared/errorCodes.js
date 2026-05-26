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
