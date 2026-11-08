import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('@/services/authService', () => ({ logout: vi.fn(), refresh: vi.fn() }));

import SessionKeeper, { tokenExpiresAt } from './SessionKeeper';
import { logout, refresh } from '@/services/authService';
import { resetActivity, takeInputForRequest } from '@/lib/auth/activity';
import { useAuthStore } from '@/store/authStore';

function jwtExpiringIn(ms: number) {
  const body = btoa(JSON.stringify({ sub: 'u1', exp: Math.floor((Date.now() + ms) / 1000) }));
  return `h.${body.replace(/=+$/, '')}.s`;
}

describe('SessionKeeper (AUTH-02, AUTH-03)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logout).mockReset();
    vi.mocked(refresh).mockReset().mockResolvedValue({});
    resetActivity();
  });
  afterEach(() => vi.useRealTimers());

  it('reads the expiry from a token', () => {
    const token = jwtExpiringIn(30 * 60 * 1000);
    expect(Math.abs((tokenExpiresAt(token) as number) - (Date.now() + 30 * 60 * 1000))).toBeLessThan(1000);
    expect(tokenExpiresAt('not-a-jwt')).toBeNull();
  });

  it('refreshes the token two minutes before it runs out', async () => {
    useAuthStore.setState({ token: jwtExpiringIn(30 * 60 * 1000), sessionKey: 'k', idleSignOutMinutes: 0 });
    render(<SessionKeeper />);
    await act(async () => { await vi.advanceTimersByTimeAsync(27 * 60 * 1000); });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000 + 1000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('warns a minute before the idle limit, and input clears the warning', async () => {
    useAuthStore.setState({ token: jwtExpiringIn(60 * 60 * 1000), sessionKey: 'k', idleSignOutMinutes: 15 });
    render(<SessionKeeper />);
    await act(async () => { await vi.advanceTimersByTimeAsync(13 * 60 * 1000); });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000 + 5000); });
    expect(screen.getByRole('alert').textContent).toMatch(/signed out in \d+ seconds/);

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(logout).not.toHaveBeenCalled();
  });

  it('does not sign out someone who just signed in after the login page sat idle', async () => {
    resetActivity(Date.now() - 40 * 60 * 1000);
    useAuthStore.getState().setSession({
      token: jwtExpiringIn(60 * 60 * 1000), user: { id: 'u1', permissions: [] } as any, idleSignOutMinutes: 15,
    });
    render(<SessionKeeper />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(logout).not.toHaveBeenCalled();
  });

  it('signs the screen out at the idle limit', async () => {
    useAuthStore.setState({ token: jwtExpiringIn(60 * 60 * 1000), sessionKey: 'k', idleSignOutMinutes: 15 });
    render(<SessionKeeper />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 5000); });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logout).mock.calls[0][0]?.message).toMatch(/15 minutes without activity/);
  });

  it('reports input once to the next request, not to background ones after it', () => {
    resetActivity(Date.now());
    expect(takeInputForRequest()).toBe(true);
    expect(takeInputForRequest()).toBe(false);
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('pointerdown'));
    expect(takeInputForRequest()).toBe(true);
    expect(takeInputForRequest()).toBe(false);
  });
});
