import { describe, it, expect } from 'vitest';
import { passwordProblem } from './password';

describe('passwordProblem', () => {
  it('enforces 12 character minimum for admin', () => {
    expect(passwordProblem('short123', { roleName: 'admin' })).toBe('Password must be at least 12 characters.');
    expect(passwordProblem('12345678901', { roleName: 'admin' })).toBe('Password must be at least 12 characters.');
  });

  it('enforces 10 character minimum for non-admin', () => {
    expect(passwordProblem('short12', { roleName: 'cashier' })).toBe('Password must be at least 10 characters.');
  });

  it('rejects passwords containing the username', () => {
    expect(passwordProblem('adminSuperSecret2026', { username: 'admin' })).toBe("The password can't contain the username.");
    expect(passwordProblem('MyUser123456Secret', { username: 'myuser' })).toBe("The password can't contain the username.");
  });

  it('rejects common dictionary words and stems', () => {
    expect(passwordProblem('password123456', { roleName: 'admin' })).toBe('That password is too easy to guess. Use a longer phrase.');
    expect(passwordProblem('administrator123', { roleName: 'admin' })).toBe('That password is too easy to guess. Use a longer phrase.');
    expect(passwordProblem('welcome123456', { roleName: 'admin' })).toBe('That password is too easy to guess. Use a longer phrase.');
  });

  it('rejects repeated characters or only digits', () => {
    expect(passwordProblem('111111111111', { roleName: 'admin' })).toBe('That password is too easy to guess. Use a longer phrase.');
    expect(passwordProblem('aaaaaaaaaaaa', { roleName: 'admin' })).toBe('That password is too easy to guess. Use a longer phrase.');
    expect(passwordProblem('12345678901234', { roleName: 'admin' })).toBe('That password is too easy to guess. Use a longer phrase.');
  });

  it('accepts valid strong passwords', () => {
    expect(passwordProblem('FalconTable#9821', { roleName: 'admin', username: 'admin_user' })).toBeNull();
    expect(passwordProblem('BlueHorizon2026!', { roleName: 'admin' })).toBeNull();
  });
});
