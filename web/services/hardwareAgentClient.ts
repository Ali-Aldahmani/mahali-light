import { HARDWARE_AGENT_URL } from '@/lib/config';

const TOKEN_KEY = 'mahali.hardwareAgentToken';

export function getHardwareAgentToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setHardwareAgentToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token || '');
}

export async function hardwareAgentHealth() {
  const res = await fetch(`${HARDWARE_AGENT_URL}/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function tryHardwarePrint({ kind, invoiceId, token, printer, copies, silent }) {
  const pairing = getHardwareAgentToken();
  if (!pairing) return { used: false };
  try {
    const res = await fetch(`${HARDWARE_AGENT_URL}/v1/print`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Token': pairing,
      },
      body: JSON.stringify({
        kind,
        invoiceId,
        apiToken: token,
        printer: printer || undefined,
        copies: copies || 1,
        silent: Boolean(silent),
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401 || res.status === 404) return { used: false };
    const body = await res.json().catch(() => ({}));
    return { used: true, ok: res.ok, body };
  } catch {
    return { used: false };
  }
}
