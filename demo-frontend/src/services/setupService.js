import http, { apiGet, apiPost } from './http.js';

export function getSetupStatus() {
  return apiGet('/setup/status');
}

export function completeSetup(payload) {
  return apiPost('/setup/complete', payload);
}

export async function testServerConnection(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/setup/ping`;
  const res = await http.get(url, { timeout: 5000 });
  return res.data?.data;
}
