const SERVER_IP =
  (typeof window !== 'undefined' && window.electron?.serverIp) ||
  import.meta.env.VITE_SERVER_IP ||
  '192.168.1.10';

export const API_BASE = `http://${SERVER_IP}:3000/api`;
export const SOCKET_URL = `http://${SERVER_IP}:3000`;
export const SERVER_HOST = SERVER_IP;

export const PC_IDENTIFIER =
  (typeof window !== 'undefined' && window.electron?.pcIdentifier) ||
  (typeof window !== 'undefined' ? `${window.location.hostname}-web` : 'web-client');

export const TIMEZONE = 'Asia/Dubai';
