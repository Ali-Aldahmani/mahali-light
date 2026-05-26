import { apiGet } from './http.js';

export function listOnline() {
  return apiGet('/presence');
}
