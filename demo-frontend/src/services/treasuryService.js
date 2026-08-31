import { apiGet } from './http.js';

export function getTreasurySummary() {
  return apiGet('/treasury/summary');
}
