function envPublic(viteKey: string, fallback: string): string {
  if (typeof process !== 'undefined' && process.env) {
    const nextKey = viteKey.replace(/^VITE_/, 'NEXT_PUBLIC_');
    const v = process.env[nextKey] || process.env[viteKey];
    if (v != null && v !== '') return v;
  }
  return fallback;
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
    const port = envPublic('NEXT_PUBLIC_EXPRESS_PORT', '3000');
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:${port}`;
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

export const PC_IDENTIFIER =
  (typeof window !== 'undefined' && (window as any).electron?.pcIdentifier) ||
  (typeof window !== 'undefined' ? `${window.location.hostname}-web` : 'web-client');

export const TIMEZONE = 'Asia/Dubai';

export const HARDWARE_AGENT_URL = envPublic('NEXT_PUBLIC_HARDWARE_AGENT_URL', 'http://127.0.0.1:17473');
