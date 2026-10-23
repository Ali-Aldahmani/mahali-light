import { localIsoDate } from '@/lib/utils/format';

// Period presets for the dashboard: this month or last month. The analytics
// hub offers the full range editor. (rangeDates still understands this_week,
// this_quarter and this_year for other callers.)
export const DASHBOARD_RANGES = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
];

export const DEFAULT_DASHBOARD_RANGE = 'this_month';

export function rangeDates(key: string, now: Date = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  let start;
  let end;
  if (key === 'this_week') {
    const day = now.getDay();
    const diff = (day + 6) % 7; // back to Monday
    start = new Date(y, m, now.getDate() - diff);
    end = new Date(y, m, start.getDate() + 6);
  } else if (key === 'this_quarter') {
    const qStart = Math.floor(m / 3) * 3;
    start = new Date(y, qStart, 1);
    end = new Date(y, qStart + 3, 0);
  } else if (key === 'last_month') {
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 0);
  } else if (key === 'this_year') {
    start = new Date(y, 0, 1);
    end = new Date(y, 11, 31);
  } else {
    start = new Date(y, m, 1);
    end = new Date(y, m + 1, 0);
  }
  return {
    start_date: localIsoDate(start),
    end_date: localIsoDate(end),
  };
}
