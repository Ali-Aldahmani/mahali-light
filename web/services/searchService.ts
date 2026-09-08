import { apiGet } from './http';

export function globalSearch(q) {
  return apiGet(`/search?q=${encodeURIComponent(q)}`);
}
