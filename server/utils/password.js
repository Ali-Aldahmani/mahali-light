const bcrypt = require('bcrypt');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { SYSTEM_ADMIN_ROLE_NAME } = require('../../shared/authzPolicy');

// Password rule for every place a password is set: user create, password
// reset and first-run setup (authentication audit AUTH-06). Existing
// passwords keep working; the rule applies the next time one is set.
const MIN_LENGTH = 10;
const ADMIN_MIN_LENGTH = 12;
const MAX_LENGTH = 200;

// The passwords people try first. Compared case-insensitively, and also with
// trailing digits and symbols removed, so "Password123!" is caught too.
const COMMON = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty', 'qwertyuiop',
  'asdfghjkl', 'zxcvbnm', 'abc', 'abcdef', 'abcdefgh', 'iloveyou', 'welcome',
  'admin', 'administrator', 'letmein', 'monkey', 'dragon', 'football',
  'baseball', 'sunshine', 'princess', 'master', 'superman', 'trustno1',
  'changeme', 'secret', 'login', 'cashier', 'manager', 'bytecra', 'mahali',
  'edara', 'dubai', 'uae', 'emirates',
]);
const ONLY_REPEATED_OR_DIGITS = /^(.)\1*$|^\d+$/;

function isAdminRole(roleName) {
  return String(roleName || '').trim().toLowerCase() === SYSTEM_ADMIN_ROLE_NAME.toLowerCase();
}

// Returns what is wrong with the password, or null when it is allowed.
function passwordProblem(password, { roleName = null, username = null } = {}) {
  const value = String(password || '');
  const min = isAdminRole(roleName) ? ADMIN_MIN_LENGTH : MIN_LENGTH;
  if (value.length < min) return `Password must be at least ${min} characters.`;
  if (value.length > MAX_LENGTH) return `Password can be at most ${MAX_LENGTH} characters.`;
  const lower = value.toLowerCase();
  const stem = lower.replace(/[\d\W_]+$/, '');
  if (COMMON.has(lower) || COMMON.has(stem) || ONLY_REPEATED_OR_DIGITS.test(value)) {
    return 'That password is too easy to guess. Use a longer phrase.';
  }
  if (username && lower.includes(String(username).toLowerCase())) {
    return 'The password can\'t contain the username.';
  }
  return null;
}

function assertPasswordAllowed(password, options) {
  const problem = passwordProblem(password, options);
  if (problem) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, problem, {
      status: 400, details: { field: 'password' },
    });
  }
}

// One bcrypt cost everywhere. Setup used a fixed 10 before.
function hashPassword(password) {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  return bcrypt.hash(password, rounds);
}

module.exports = {
  MIN_LENGTH, ADMIN_MIN_LENGTH, MAX_LENGTH, passwordProblem, assertPasswordAllowed, hashPassword,
};
