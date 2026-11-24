import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/login' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => nav.pathname,
}));

const api = vi.hoisted(() => ({ getPublicAppSettings: vi.fn() }));
vi.mock('@/services/appSettingsService', () => ({
  getPublicAppSettings: api.getPublicAppSettings,
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}));

import SetupGateClient, { retryDelayMs } from './SetupGateClient';
import { useSetupStore } from '@/store/setupStore';

// Engineering audit F-FE-01: a failed settings check sent a till to the
// create-admin wizard. Only the server's own answer may do that.
describe('SetupGateClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    nav.replace.mockReset();
    nav.pathname = '/login';
    api.getPublicAppSettings.mockReset();
    useSetupStore.setState({ completed: null });
  });
  afterEach(() => vi.useRealTimers());

  it('shows "can\'t reach the server" instead of the setup wizard when the check fails', async () => {
    api.getPublicAppSettings.mockRejectedValue(new Error('Network Error'));
    render(<SetupGateClient><p>sign-in page</p></SetupGateClient>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(screen.getByRole('alert')).toHaveTextContent("Can't reach the server");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(useSetupStore.getState().completed).toBeNull();
    expect(screen.queryByText('sign-in page')).toBeNull();
  });

  it('retries by itself and carries on once the server answers', async () => {
    api.getPublicAppSettings
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ setup_completed: true });
    render(<SetupGateClient><p>sign-in page</p></SetupGateClient>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(retryDelayMs(1)); });
    expect(api.getPublicAppSettings).toHaveBeenCalledTimes(2);
    expect(screen.getByText('sign-in page')).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('"Try again now" asks the server straight away', async () => {
    api.getPublicAppSettings
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ setup_completed: true });
    render(<SetupGateClient><p>sign-in page</p></SetupGateClient>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: /try again now/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('sign-in page')).toBeInTheDocument();
  });

  it('still opens the setup wizard when the server says setup is not done', async () => {
    api.getPublicAppSettings.mockResolvedValue({ setup_completed: false });
    render(<SetupGateClient><p>sign-in page</p></SetupGateClient>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(nav.replace).toHaveBeenCalledWith('/setup');
  });

  it('backs off 2 s, 4 s, 8 s, then every 15 s', () => {
    expect([1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 15000, 15000]);
  });
});
