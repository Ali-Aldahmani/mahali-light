const SERVER_IP =
  (typeof window !== 'undefined' && window.electron?.serverIp) ||
  import.meta.env.VITE_SERVER_IP ||
  '192.168.1.10';

const SERVER_PORT =
  (typeof window !== 'undefined' && window.electron?.serverPort) ||
  import.meta.env.VITE_SERVER_PORT ||
  3000;

export const API_BASE = `http://${SERVER_IP}:${SERVER_PORT}/api`;
export const SOCKET_URL = `http://${SERVER_IP}:${SERVER_PORT}`;
export const FILES_BASE = `http://${SERVER_IP}:${SERVER_PORT}/files`;
export const SERVER_HOST = SERVER_IP;

// Convert a stored relative image path (e.g. "products/<id>/123.webp")
// into an absolute URL that hits the static file server.
export function fileUrl(relPath) {
  if (!relPath) return null;
  if (/^https?:\/\//.test(relPath)) return relPath;
  const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath;
  return `${FILES_BASE}/${clean}`;
}

export const PC_IDENTIFIER =
  (typeof window !== 'undefined' && window.electron?.pcIdentifier) ||
  (typeof window !== 'undefined' ? `${window.location.hostname}-web` : 'web-client');

export const TIMEZONE = 'Asia/Dubai';
