import { apiGet, apiPut, apiDelete } from './http.js';
import http from './http.js';

export function getStoreSettings() {
  return apiGet('/settings/store');
}

export function updateStoreSettings(patch) {
  return apiPut('/settings/store', patch);
}

export async function uploadStoreLogo(file) {
  const form = new FormData();
  form.append('logo', file);
  const res = await http.post('/settings/logo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data;
}

export function removeStoreLogo() {
  return apiDelete('/settings/logo');
}
