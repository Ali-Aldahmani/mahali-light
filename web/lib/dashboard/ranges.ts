import { localIsoDate } from '@/lib/utils/format';

// Quick-range presets for the dashboard. We deliberately stick to four
// useful windows; the analytics hub offers the full range editor.
export const DASHBOARD_RANGES = [
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
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
