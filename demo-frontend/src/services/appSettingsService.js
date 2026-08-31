import { apiGet, apiPut } from './http.js';

export function getAppSettings() {
  return apiGet('/app-settings');
}
export function getPublicAppSettings() {
  return apiGet('/app-settings/public');
}
export function updateAppSettings(patch) {
  return apiPut('/app-settings', patch);
}
