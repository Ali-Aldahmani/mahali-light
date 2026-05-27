import { apiGet } from './http.js';

export function globalSearch(q) {
  return apiGet(`/search?q=${encodeURIComponent(q)}`);
}
