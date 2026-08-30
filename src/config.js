function electronCfg() {
  return typeof window !== 'undefined' ? window.electron : null;
}

function resolveOrigin() {
  const el = electronCfg();
  const ip = el?.serverIp || import.meta.env.VITE_SERVER_IP || '127.0.0.1';
  const port =
    Number(el?.serverPort) ||
    Number(import.meta.env.VITE_SERVER_PORT) ||
    3002;
  const scheme = el?.serverUseHttps === true ? 'https' : 'http';
  return `${scheme}://${ip}:${port}`;
}

export function getApiOrigin() {
  return resolveOrigin();
}

export function getApiBase() {
  return `${resolveOrigin()}/api`;
}

export function getSocketUrl() {
  return resolveOrigin();
}

export function getFilesBase() {
  return `${resolveOrigin()}/files`;
}

/** @deprecated Prefer getApiBase() — kept for call-site compatibility. */
export const API_BASE = getApiBase();
/** @deprecated Prefer getSocketUrl() */
export const SOCKET_URL = getSocketUrl();
/** @deprecated Prefer getFilesBase() */
export const FILES_BASE = getFilesBase();

export const SERVER_HOST =
  (typeof window !== 'undefined' && window.electron?.serverIp) ||
  import.meta.env.VITE_SERVER_IP ||
  '127.0.0.1';

export function fileUrl(relPath) {
  if (!relPath) return null;
  if (/^https?:\/\//.test(relPath)) return relPath;
  const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return `${getFilesBase()}/${clean}`;
}

export const PC_IDENTIFIER =
  (typeof window !== 'undefined' && window.electron?.pcIdentifier) ||
  (typeof window !== 'undefined' ? `${window.location.hostname}-web` : 'web-client');

export const TIMEZONE = 'Asia/Dubai';
