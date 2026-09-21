import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from './http';
import { useAuthStore } from '@/store/authStore';

// Regression test for a real bug found while investigating a report that
// login sometimes gets silently undone: the 401 handler used to clear the
// session whenever *a* token was current, not whenever the *failing
// request's own* token was still current. A request dispatched under an
// old session can resolve after the user has already logged back in under
// a new one — that stale rejection must not nuke the new session.
describe('http 401 interceptor — stale-session race', () => {
  const originalAdapter = http.defaults.adapter;
  let capturedConfig: any;
  let rejectAdapter: (reason: any) => void;

  beforeEach(() => {
    useAuthStore.setState({ user: null, token: null, permissions: [] });
    capturedConfig = undefined;
    http.defaults.adapter = (config: any) =>
      new Promise((_resolve, reject) => {
        capturedConfig = config;
        rejectAdapter = reject;
      });
  });

  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('does not clear a newer session when a stale request (sent under the old token) later 401s', async () => {
    useAuthStore.setState({ token: 'TOKEN_A', user: { id: 'u1', permissions: [] } as any });

    const pending = http.get('/some/protected/path').catch((e) => e);
    // Let the request interceptor run and the adapter capture the config
    // (with the Authorization header baked in from TOKEN_A).
    await new Promise((r) => setTimeout(r, 0));
    expect(capturedConfig.headers.Authorization).toBe('Bearer TOKEN_A');

    // A fresh login replaces the session while the old request is still in flight.
    useAuthStore.getState().setSession({ token: 'TOKEN_B', user: { id: 'u2', permissions: [] } as any });

    // The stale request now fails — it was sent under TOKEN_A, which the
    // server has since invalidated (replaced by the new login).
    rejectAdapter({
      response: {
        status: 401,
        data: { error: { code: 'AUTH_TOKEN_INVALID', message: 'Invalid token' } },
      },
      config: capturedConfig,
      isAxiosError: true,
    });
    await pending;

    expect(useAuthStore.getState().token).toBe('TOKEN_B');
    expect(useAuthStore.getState().user?.id).toBe('u2');
  });

  it('still clears the session when the request that 401s matches the current token', async () => {
    useAuthStore.setState({ token: 'TOKEN_A', user: { id: 'u1', permissions: [] } as any });

    const pending = http.get('/some/protected/path').catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));

    rejectAdapter({
      response: {
        status: 401,
        data: { error: { code: 'AUTH_SESSION_EXPIRED', message: 'Session expired' } },
      },
      config: capturedConfig,
      isAxiosError: true,
    });
    await pending;

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
