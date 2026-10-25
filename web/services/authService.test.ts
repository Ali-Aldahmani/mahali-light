import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./http', () => ({ apiPost: vi.fn(), apiGet: vi.fn() }));
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { logout } from './authService';
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
