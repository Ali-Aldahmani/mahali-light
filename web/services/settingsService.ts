import { apiGet, apiPut, apiDelete } from './http';
import http, { uploadConfig, type UploadOptions } from './http';

export function getStoreSettings() {
  return apiGet('/settings/store');
}

export function updateStoreSettings(patch) {
  return apiPut('/settings/store', patch);
}

export async function uploadStoreLogo(file, opts?: UploadOptions) {
  const form = new FormData();
  form.append('logo', file);
  const res = await http.post('/settings/logo', form, uploadConfig(opts));
  return res.data?.data;
}

export function removeStoreLogo() {
  return apiDelete('/settings/logo');
}
