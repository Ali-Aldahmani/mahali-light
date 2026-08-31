export function getApiOrigin() {
  return '';
}

export function getApiBase() {
  return '/api';
}

export function getSocketUrl() {
  return '';
}

export function getFilesBase() {
  return '/files';
}

export const API_BASE = '/api';
export const SOCKET_URL = '';
export const FILES_BASE = '/files';
export const SERVER_HOST = '127.0.0.1';

export function fileUrl(relPath) {
  if (!relPath) return null;
  if (/^https?:\/\//.test(relPath)) return relPath;
  return relPath;
}

export const PC_IDENTIFIER = 'DEMO-TERMINAL-01';
export const TIMEZONE = 'Asia/Dubai';
