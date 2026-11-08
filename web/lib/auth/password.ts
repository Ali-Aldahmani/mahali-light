export const MIN_LENGTH = 10;
export const ADMIN_MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

export const COMMON_PASSWORDS = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty', 'qwertyuiop',
  'asdfghjkl', 'zxcvbnm', 'abc', 'abcdef', 'abcdefgh', 'iloveyou', 'welcome',
  'admin', 'administrator', 'letmein', 'monkey', 'dragon', 'football',
  'baseball', 'sunshine', 'princess', 'master', 'superman', 'trustno1',
  'changeme', 'secret', 'login', 'cashier', 'manager', 'bytecra', 'mahali',
  'edara', 'dubai', 'uae', 'emirates',
]);

const ONLY_REPEATED_OR_DIGITS = /^(.)\1*$|^\d+$/;

export function isAdminRole(roleName?: string | null): boolean {
  return String(roleName || '').trim().toLowerCase() === 'admin';
}

export interface PasswordProblemOptions {
  roleName?: string | null;
  username?: string | null;
}

/**
 * Validates a password using the exact same rules as the server (server/utils/password.js).
 * Returns an error string if invalid, or null if allowed.
 */
export function passwordProblem(
  password: string | undefined | null,
  options: PasswordProblemOptions = {},
): string | null {
  const value = String(password || '');
  const min = isAdminRole(options.roleName) ? ADMIN_MIN_LENGTH : MIN_LENGTH;

  if (value.length < min) {
    return `Password must be at least ${min} characters.`;
  }
  if (value.length > MAX_LENGTH) {
    return `Password can be at most ${MAX_LENGTH} characters.`;
  }

  const lower = value.toLowerCase();
  const stem = lower.replace(/[\d\W_]+$/, '');

  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(stem) || ONLY_REPEATED_OR_DIGITS.test(value)) {
    return 'That password is too easy to guess. Use a longer phrase.';
  }

  if (options.username && lower.includes(String(options.username).toLowerCase())) {
    return "The password can't contain the username.";
  }

  return null;
}

