// Next.js only inlines NEXT_PUBLIC_* values into browser code where they are
// written out literally (`process.env.NEXT_PUBLIC_X`); a computed lookup like
// `process.env[key]` is always undefined in the browser. So every public
// setting is read literally here.
const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_EXPRESS_PORT: process.env.NEXT_PUBLIC_EXPRESS_PORT,
  NEXT_PUBLIC_HARDWARE_AGENT_URL: process.env.NEXT_PUBLIC_HARDWARE_AGENT_URL,
  NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
  NEXT_PUBLIC_SERVER_IP: process.env.NEXT_PUBLIC_SERVER_IP,
  NEXT_PUBLIC_SERVER_PORT: process.env.NEXT_PUBLIC_SERVER_PORT,
};

function envPublic(viteKey: string, fallback: string): string {
  const v = PUBLIC_ENV[viteKey.replace(/^VITE_/, 'NEXT_PUBLIC_')];
  return v != null && v !== '' ? v : fallback;
}

function electronCfg(): any {
  return typeof window !== 'undefined' ? (window as any).electron : null;
}

function isBrowserWebClient(): boolean {
  return typeof window !== 'undefined' && !(window as any).electron;
}

/**
 * Electron tills still talk to a configured LAN API host.
 * Browser / Next.js clients use same-origin `/api` (proxied to Express).
 */
function resolveOrigin(): string {
  const el = electronCfg();
  if (el?.serverIp) {
    const port = Number(el.serverPort) || Number(envPublic('VITE_SERVER_PORT', '3000'));
    const scheme = el.serverUseHttps === true ? 'https' : 'http';
    return `${scheme}://${el.serverIp}:${port}`;
  }
  if (isBrowserWebClient()) {
    return '';
  }
  const ip = envPublic('VITE_SERVER_IP', '127.0.0.1');
  const port = Number(envPublic('VITE_SERVER_PORT', '3002'));
  return `http://${ip}:${port}`;
}

export function getApiOrigin(): string {
  if (isBrowserWebClient()) return typeof window !== 'undefined' ? window.location.origin : '';
  return resolveOrigin();
}

export function getApiBase(): string {
  const origin = resolveOrigin();
  return origin ? `${origin}/api` : '/api';
}

export function getSocketUrl(): string {
  if (isBrowserWebClient() && typeof window !== 'undefined') {
    const explicit = envPublic('NEXT_PUBLIC_SOCKET_URL', '');
    if (explicit) return explicit.replace(/\/$/, '');
    // In Docker the page, the API and live updates share one HTTPS address
    // (Caddy). Local development sets the API's own port instead.
    const port = envPublic('NEXT_PUBLIC_EXPRESS_PORT', '');
    const { protocol, hostname, origin } = window.location;
    return port ? `${protocol}//${hostname}:${port}` : origin;
  }
  return resolveOrigin();
}

export function getFilesBase(): string {
  const origin = resolveOrigin();
  return origin ? `${origin}/files` : '/files';
}

/** @deprecated Prefer getApiBase() — kept for call-site compatibility. */
export const API_BASE = getApiBase();
/** @deprecated Prefer getSocketUrl() */
export const SOCKET_URL = getSocketUrl();
/** @deprecated Prefer getFilesBase() */
export const FILES_BASE = getFilesBase();

export const SERVER_HOST =
  (typeof window !== 'undefined' && (window as any).electron?.serverIp) ||
  (typeof window !== 'undefined' ? window.location.hostname : envPublic('VITE_SERVER_IP', '127.0.0.1'));

export function fileUrl(relPath?: string | null): string | null {
  if (!relPath) return null;
  if (/^https?:\/\//.test(relPath)) return relPath;
  const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return `${getFilesBase()}/${clean}`;
}

const BROWSER_PC_ID_KEY = 'mahali.browserPcId';

// One identifier per browser, kept in localStorage. It used to be the page's
// hostname — the server's name, identical on every PC — so two PCs signed in
// as the same user replaced each other's session.
export function browserPcIdentifier(storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  try {
    const existing = storage?.getItem(BROWSER_PC_ID_KEY);
    if (existing) return existing;
    // crypto.randomUUID is missing on plain-HTTP LAN pages (not a secure context).
    const random =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const id = `web-${random}`;
    storage?.setItem(BROWSER_PC_ID_KEY, id);
    return id;
  } catch (_e) {
    return typeof window !== 'undefined' ? `${window.location.hostname}-web` : 'web-client';
  }
}

export const PC_IDENTIFIER =
  (typeof window !== 'undefined' && (window as any).electron?.pcIdentifier) ||
  (typeof window !== 'undefined' ? browserPcIdentifier(window.localStorage) : 'web-client');

export const TIMEZONE = 'Asia/Dubai';

export const HARDWARE_AGENT_URL = envPublic('NEXT_PUBLIC_HARDWARE_AGENT_URL', 'http://127.0.0.1:17473');
