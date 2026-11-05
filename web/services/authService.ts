import { apiGet, apiPost } from './http';
import { PC_IDENTIFIER } from '@/lib/config';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';

export function changePassword(currentPassword: string, newPassword: string) {
  return apiPost('/auth/change-password', { currentPassword, newPassword });
}

let hostname = null;
async function getHostname() {
  if (hostname) return hostname;
  if (typeof window !== 'undefined' && window.electron?.getSystemInfo) {
    try {
      const info = await window.electron.getSystemInfo();
      hostname = info?.hostname || PC_IDENTIFIER;
      return hostname;
    } catch (_e) {
      // ignore
    }
  }
  hostname = typeof window !== 'undefined' ? window.location.hostname : 'web';
  return hostname;
}

export async function login({ username, password }) {
  const host = await getHostname();
  const data = await apiPost('/auth/login', {
    username,
    password,
    pcIdentifier: PC_IDENTIFIER,
    hostname: host,
  });
  useAuthStore.getState().setSession({
    token: data.token, user: data.user, idleSignOutMinutes: data.idleSignOutMinutes,
  });
  return data;
}

// Signs out and says whether the server confirmed the session is closed.
// This PC's credentials are always dropped (a shared till must not stay
// signed in), but "Signed out" is only reported once the server has closed
// the session; otherwise the user is told the session is still open there.
// A 401 means the server had already closed it, which also counts.
export async function logout({ message = 'Signed out.' }: { message?: string } = {}): Promise<{ confirmed: boolean }> {
  const token = useAuthStore.getState().token;
  let confirmed = false;
  try {
    for (let attempt = 0; attempt < 2 && !confirmed; attempt += 1) {
      confirmed = await tryServerLogout(token);
    }
  } finally {
    useAuthStore.getState().logoutLocal();
  }
  if (confirmed) {
    toast.success(message);
  } else {
    // Authentication audit AUTH-09: keep trying in the background while this
    // page is open. The token is held in memory only, never stored.
    if (token) retryLogoutLater(token);
    toast.warning(
      "Signed out on this PC, but the server didn't confirm it yet. It keeps trying while this page is open; the session also ends on its own within 30 minutes. You can use \"Sign out all my devices\" after signing in again.",
    );
  }
  return { confirmed };
}

// True once the server has closed the session (a 401 means it already was).
async function tryServerLogout(token: string | null): Promise<boolean> {
  if (!token) return true;
  try {
    await apiPost('/auth/logout', undefined, { headers: { Authorization: `Bearer ${token}` } });
    return true;
  } catch (err: any) {
    return err?.status === 401;
  }
}

const RETRY_LOGOUT_MS = 15000;
const pendingLogouts = new Set<string>();
function retryLogoutLater(token: string) {
  if (pendingLogouts.has(token)) return;
  pendingLogouts.add(token);
  const attempt = async () => {
    if (await tryServerLogout(token)) {
      pendingLogouts.delete(token);
      return;
    }
    setTimeout(attempt, RETRY_LOGOUT_MS);
  };
  setTimeout(attempt, RETRY_LOGOUT_MS);
}

// Swaps the token for a fresh one in the same session (tokens last 30
// minutes). Called by SessionKeeper shortly before the token runs out.
export async function refresh() {
  const data = await apiPost('/auth/refresh');
  useAuthStore.getState().setToken(data.token);
  if (data.user) useAuthStore.getState().setUser(data.user);
  return data;
}

// Closes every open session of this user, on every PC and phone.
export async function logoutAllDevices() {
  await apiPost('/auth/logout-all');
  useAuthStore.getState().logoutLocal();
  toast.success('Signed out on all your devices.');
}

export async function getMe() {
  const data = await apiGet('/auth/me');
  if (data?.user) useAuthStore.getState().setUser(data.user);
  return data?.user;
}
