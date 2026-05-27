import axios from 'axios';
import { API_BASE } from '../config.js';
import { useAuthStore } from '../store/authStore.js';
import { useOfflineStore } from '../store/offlineStore.js';
import { useUiErrorStore } from '../store/uiErrorStore.js';
import { toast } from '../store/toastStore.js';
import { addBreadcrumb } from './breadcrumbService.js';

const APP_VERSION = '0.1.0';

const http = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  config.headers = config.headers || {};
  if (token) config.headers.Authorization = `Bearer ${token}`;

  const electron = typeof window !== 'undefined' ? window.electron : null;
  if (electron?.pcIdentifier) {
    config.headers['X-PC-Identifier'] = electron.pcIdentifier;
  }
  config.headers['X-App-Version'] = APP_VERSION;

  return config;
});

http.interceptors.response.use(
  (res) => {
    useOfflineStore.getState().setOffline(false);
    const method = res.config?.method?.toUpperCase();
    const url = res.config?.url;
    addBreadcrumb('api_call', { method, url, status: res.status });
    return res;
  },
  (err) => {
    const config = err.config || {};
    const method = config.method?.toUpperCase();
    const url = config.url;

    if (!err.response) {
      if (err.code === 'ECONNABORTED') {
        toast.error('Request timed out. Please try again.', {
          duration: 0,
          actionLabel: 'Retry',
          onAction: () => http.request(config),
        });
        addBreadcrumb('api_timeout', { method, url });
        return Promise.reject({
          code: 'NETWORK_TIMEOUT',
          message: 'Request timed out.',
        });
      }

      useOfflineStore.getState().setOffline(true);
      useOfflineStore.getState().startReachabilityCheck();
      addBreadcrumb('api_offline', { method, url });
      return Promise.reject({
        code: 'NETWORK_ERROR',
        message: 'Network unavailable.',
      });
    }

    const { status, data } = err.response;
    const code = data?.error?.code;
    const message = data?.error?.message || 'Request failed.';
    const details = data?.error?.details;
    const field = data?.error?.field;

    addBreadcrumb('api_error', { method, url, status, code, message });

    if (
      status === 401 &&
      (code === 'AUTH_SESSION_EXPIRED' ||
        code === 'AUTH_TOKEN_INVALID' ||
        code === 'AUTH_TOKEN_MISSING' ||
        code === 'AUTH_FORCE_LOGGED_OUT')
    ) {
      const { token } = useAuthStore.getState();
      if (token) {
        try {
          sessionStorage.setItem(
            'mahali.returnRoute',
            window.location.pathname + window.location.search,
          );
        } catch (_e) {
          /* ignore */
        }
        useUiErrorStore.getState().showSessionExpired();
        useAuthStore.getState().logoutLocal();
      }
      return Promise.reject({ code, message, details, status, field });
    }

    if (status === 403 && code === 'AUTH_NO_PERMISSION') {
      useUiErrorStore.getState().showPermissionDenied({
        action: message,
        permission: details?.permission || null,
      });
      return Promise.reject({ code, message, details, status, field });
    }

    if (status >= 500) {
      toast.error(message || 'Something went wrong on the server.');
    }

    return Promise.reject({ code, message, details, status, field });
  },
);

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

export async function apiGetWithMeta(url, config) {
  const res = await http.get(url, config);
  return { data: res.data?.data, meta: res.data?.meta };
}

export default http;
