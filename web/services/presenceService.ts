import { apiGet } from './http';

export function listOnline() {
  return apiGet('/presence');
}
