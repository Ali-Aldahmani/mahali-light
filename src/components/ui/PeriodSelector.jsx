import { useMemo } from 'react';
import Button from './Button.jsx';
import Input from './Input.jsx';
import { cn } from '../../utils/cn.js';

// Returns ISO date strings for a quick-pick window.
export function getQuickRange(quick) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const isoUtc = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

  if (quick === 'today') {
    const t = isoUtc(year, month, day);
    return { startDate: t, endDate: t };
  }
  if (quick === 'yesterday') {
    const t = isoUtc(year, month, day - 1);
    return { startDate: t, endDate: t };
  }
  if (quick === 'this_week') {
    // Monday → Sunday window (Mon=1..Sun=7).
    const jsDow = now.getDay();
    const offset = jsDow === 0 ? 6 : jsDow - 1;
    return {
      startDate: isoUtc(year, month, day - offset),
      endDate: isoUtc(year, month, day - offset + 6),
    };
  }
  if (quick === 'last_week') {
    const jsDow = now.getDay();
    const offset = jsDow === 0 ? 6 : jsDow - 1;
    return {
      startDate: isoUtc(year, month, day - offset - 7),
      endDate: isoUtc(year, month, day - offset - 1),
    };
  }
  if (quick === 'this_month') {
    return {
      startDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
      endDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
    };
  }
  if (quick === 'last_month') {
    return {
      startDate: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
      endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    };
  }
  if (quick === 'this_quarter') {
    const q = Math.floor(month / 3);
    return {
      startDate: new Date(Date.UTC(year, q * 3, 1)).toISOString().slice(0, 10),
      endDate: new Date(Date.UTC(year, q * 3 + 3, 0)).toISOString().slice(0, 10),
    };
  }
  if (quick === 'last_quarter') {
    const q = Math.floor(month / 3) - 1;
    const ay = q < 0 ? year - 1 : year;
    const aq = (q + 4) % 4;
    return {
      startDate: new Date(Date.UTC(ay, aq * 3, 1)).toISOString().slice(0, 10),
      endDate: new Date(Date.UTC(ay, aq * 3 + 3, 0)).toISOString().slice(0, 10),
    };
  }
  if (quick === 'half_year') {
    // First or second half depending on current month.
    const h2 = month >= 6;
    return {
      startDate: `${year}-${h2 ? '07' : '01'}-01`,
      endDate: `${year}-${h2 ? '12' : '06'}-${h2 ? 31 : 30}`,
    };
  }
  if (quick === 'this_year') {
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    };
  }
  return null;
}

const ALL_QUICK_BUTTONS = {
  today:        { id: 'today',        label: 'Today' },
  yesterday:    { id: 'yesterday',    label: 'Yesterday' },
  this_week:    { id: 'this_week',    label: 'This Week' },
  last_week:    { id: 'last_week',    label: 'Last Week' },
  this_month:   { id: 'this_month',   label: 'This Month' },
  last_month:   { id: 'last_month',   label: 'Last Month' },
  this_quarter: { id: 'this_quarter', label: 'This Quarter' },
  last_quarter: { id: 'last_quarter', label: 'Last Quarter' },
  half_year:    { id: 'half_year',    label: 'Half Year' },
  this_year:    { id: 'this_year',    label: 'This Year' },
};

const DEFAULT_PRESETS = [
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
];

const REPORT_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'half_year',
  'this_year',
];

export { REPORT_PRESETS };

// Compact period selector with quick presets plus a custom date range pair.
// Mode: 'range' (default) shows start + end; 'single' renders one as-of date.
export default function PeriodSelector({
  mode = 'range',
  startDate,
  endDate,
  asOfDate,
  onChange,
  presets = DEFAULT_PRESETS,
  className = '',
}) {
  const buttons = presets
    .map((id) => ALL_QUICK_BUTTONS[id])
    .filter(Boolean);

  const activeQuick = useMemo(() => {
    if (mode !== 'range') return null;
    for (const b of buttons) {
      const r = getQuickRange(b.id);
      if (r && r.startDate === startDate && r.endDate === endDate) return b.id;
    }
    return null;
  }, [mode, startDate, endDate, buttons]);

  if (mode === 'single') {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)}>
        <span className="text-sm text-ink-muted">As of</span>
        <Input
          type="date"
          value={asOfDate || ''}
          onChange={(e) => onChange({ asOfDate: e.target.value })}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex flex-wrap gap-1.5">
        {buttons.map((b) => (
          <Button
            key={b.id}
            variant={activeQuick === b.id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => onChange(getQuickRange(b.id))}
          >
            {b.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <Input
          type="date"
          value={startDate || ''}
          onChange={(e) => onChange({ startDate: e.target.value, endDate })}
        />
        <span className="text-ink-muted">to</span>
        <Input
          type="date"
          value={endDate || ''}
          onChange={(e) => onChange({ startDate, endDate: e.target.value })}
        />
      </div>
    </div>
  );
}
