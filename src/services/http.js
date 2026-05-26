import axios from 'axios';
import { API_BASE } from '../config.js';
import { useAuthStore } from '../store/authStore.js';
import { toast } from '../store/toastStore.js';

const http = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (!err.response) {
      // Network / offline.
      toast.error('Network unavailable. Check your connection to the server.');
      return Promise.reject({
        code: 'NETWORK_ERROR',
        message: 'Network unavailable.',
      });
    }

    const { status, data } = err.response;
    const code = data?.error?.code;
    const message = data?.error?.message || 'Request failed.';
    const details = data?.error?.details;

    if (
      status === 401 &&
      (code === 'AUTH_SESSION_EXPIRED' ||
        code === 'AUTH_TOKEN_INVALID' ||
        code === 'AUTH_TOKEN_MISSING')
    ) {
      // Auto logout on session expiry / invalid token.
      const { token, logoutLocal } = useAuthStore.getState();
      if (token) {
        toast.error('Your session has expired. Please sign in again.');
        logoutLocal();
      }
    }

    return Promise.reject({ code, message, details, status });
  },
);

// Unwrap the standard { success, data } envelope.
export async function apiGet(url, config) {
  const res = await http.get(url, config);
  return res.data?.data;
}
export async function apiPost(url, body, config) {
  const res = await http.post(url, body, config);
  return res.data?.data;
}
export async function apiPut(url, body, config) {
  const res = await http.put(url, body, config);
  return res.data?.data;
}
export async function apiDelete(url, config) {
  const res = await http.delete(url, config);
  return res.data?.data;
}

// Returns both data + meta (used for paginated lists).
export async function apiGetWithMeta(url, config) {
  const res = await http.get(url, config);
  return { data: res.data?.data, meta: res.data?.meta };
}

export default http;
