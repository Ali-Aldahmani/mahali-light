import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./http', () => ({ apiPost: vi.fn(), apiGet: vi.fn() }));
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { logout, logoutAllDevices, refresh } from './authService';
import { apiPost } from './http';
import { toast } from '@/store/toastStore';
import { useAuthStore } from '@/store/authStore';

describe('logout', () => {
  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    useAuthStore.setState({ token: 't', user: { id: 'u1' } as any });
  });

  it('reports "Signed out" once the server confirms', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ loggedOut: true });
    expect(await logout()).toEqual({ confirmed: true });
    expect(toast.success).toHaveBeenCalledWith('Signed out.');
    expect(useAuthStore.getState().token).toBeFalsy();
  });

  it('retries once, then clears this PC but says the server did not confirm', async () => {
    vi.mocked(apiPost).mockRejectedValue({ status: 0, message: 'Network Error' });
    expect(await logout()).toEqual({ confirmed: false });
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().token).toBeFalsy();
  });

  it('treats an already-closed session (401) as confirmed', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce({ status: 401, code: 'AUTH_SESSION_EXPIRED' });
    expect(await logout()).toEqual({ confirmed: true });
    expect(toast.success).toHaveBeenCalledWith('Signed out.');
  });
});

describe('logout retries in the background (AUTH-09)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(apiPost).mockReset();
    useAuthStore.setState({ token: 'stale-token', user: { id: 'u1' } as any });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps sending the old token until the server closes the session', async () => {
    vi.mocked(apiPost)
      .mockRejectedValueOnce({ status: 0 })
      .mockRejectedValueOnce({ status: 0 })
      .mockRejectedValueOnce({ status: 0 })
      .mockResolvedValueOnce({ loggedOut: true });
    expect(await logout()).toEqual({ confirmed: false });
    expect(useAuthStore.getState().token).toBeFalsy();

    await vi.advanceTimersByTimeAsync(15000);
    expect(apiPost).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15000);
    expect(apiPost).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(apiPost).mock.calls) {
      expect(call[0]).toBe('/auth/logout');
      expect(call[2]).toEqual({ headers: { Authorization: 'Bearer stale-token' } });
    }
    // Confirmed: no more attempts.
    await vi.advanceTimersByTimeAsync(60000);
    expect(apiPost).toHaveBeenCalledTimes(4);
  });
});

describe('session token', () => {
  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
    useAuthStore.getState().setSession({ token: 'first', user: { id: 'u1' } as any, idleSignOutMinutes: 15 });
  });

  it('refresh swaps the token but keeps the session', async () => {
    const key = useAuthStore.getState().sessionKey;
    vi.mocked(apiPost).mockResolvedValueOnce({ token: 'second', user: { id: 'u1' } });
    await refresh();
    expect(useAuthStore.getState().token).toBe('second');
    expect(useAuthStore.getState().sessionKey).toBe(key);
  });

  it('signing out all devices clears this screen', async () => {
    vi.mocked(apiPost).mockResolvedValueOnce({ loggedOut: true, sessionsClosed: 3 });
    await logoutAllDevices();
    expect(apiPost).toHaveBeenCalledWith('/auth/logout-all');
    expect(useAuthStore.getState().token).toBeFalsy();
  });
});
