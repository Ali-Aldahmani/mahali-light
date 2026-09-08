import { apiGet } from './http';

export function getTreasurySummary() {
  return apiGet('/treasury/summary');
}
