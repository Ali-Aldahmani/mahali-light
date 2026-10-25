import { apiGet, apiPost } from './http';
import { PC_IDENTIFIER } from '@/lib/config';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';

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
  useAuthStore.getState().setSession({ token: data.token, user: data.user });
  return data;
}

// Signs out and says whether the server confirmed the session is closed.
// This PC's credentials are always dropped (a shared till must not stay
// signed in), but "Signed out" is only reported once the server has closed
// the session; otherwise the user is told the session is still open there.
// A 401 means the server had already closed it, which also counts.
export async function logout(): Promise<{ confirmed: boolean }> {
  let confirmed = false;
  try {
    for (let attempt = 0; attempt < 2 && !confirmed; attempt += 1) {
      try {
        await apiPost('/auth/logout');
        confirmed = true;
      } catch (err: any) {
        if (err?.status === 401) confirmed = true;
      }
    }
  } finally {
    useAuthStore.getState().logoutLocal();
  }
  if (confirmed) {
    toast.success('Signed out.');
  } else {
    toast.warning(
      "Signed out on this PC, but the server didn't confirm it. The session closes on its own after 30 minutes, or a manager can force it closed from the Users page.",
    );
  }
  return { confirmed };
}

export async function refresh() {
  const data = await apiPost('/auth/refresh');
  useAuthStore.getState().setSession({ token: data.token, user: data.user });
  return data;
}

export async function getMe() {
  const data = await apiGet('/auth/me');
  if (data?.user) useAuthStore.getState().setUser(data.user);
  return data?.user;
}
