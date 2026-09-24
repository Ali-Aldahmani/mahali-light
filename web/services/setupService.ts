import http, { apiGet, apiPost } from './http';

export function getSetupStatus() {
  return apiGet('/setup/status');
}

// The setup code is printed in the server log / setup-code.txt; the server
// never hands it out over HTTP. Check it before the wizard continues.
export function verifySetupCode(code: string) {
  return apiPost('/setup/verify-code', { code });
}

export function completeSetup(payload, setupToken?: string) {
  const headers = setupToken ? { 'X-Setup-Token': setupToken } : undefined;
  return apiPost('/setup/complete', payload, headers ? { headers } : undefined);
}

export async function testServerConnection(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/setup/ping`;
  const res = await http.get(url, { timeout: 5000 });
  return res.data?.data;
}
