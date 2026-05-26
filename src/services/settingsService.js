import { apiGet, apiPut } from './http.js';

export function listSettings() {
  return apiGet('/settings');
}

export function getSetting(key) {
  return apiGet(`/settings/${encodeURIComponent(key)}`);
}

export function updateSetting(key, value) {
  return apiPut(`/settings/${encodeURIComponent(key)}`, { value });
}
