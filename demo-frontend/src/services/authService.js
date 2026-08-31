import { apiGet, apiPost } from './http.js';
import { PC_IDENTIFIER } from '../config.js';
import { useAuthStore } from '../store/authStore.js';

let hostname = null;
async function getHostname() {
  if (hostname) return hostname;
  hostname = PC_IDENTIFIER;
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

export async function logout() {
  try {
    await apiPost('/auth/logout');
  } finally {
    useAuthStore.getState().logoutLocal();
  }
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
