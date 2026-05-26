import { useMemo } from 'react';
import Button from './Button.jsx';
import Input from './Input.jsx';
import { cn } from '../../utils/cn.js';

// Returns ISO date strings for a quick-pick window.
export function getQuickRange(quick) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

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
  if (quick === 'this_year') {
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    };
  }
  return null;
}

const QUICK_BUTTONS = [
  { id: 'this_month',   label: 'This Month' },
  { id: 'last_month',   label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'last_quarter', label: 'Last Quarter' },
  { id: 'this_year',    label: 'This Year' },
];

// Compact period selector with quick presets plus a custom date range pair.
// Mode: 'range' (default) shows start + end; 'single' renders one as-of date.
export default function PeriodSelector({
  mode = 'range',
  startDate,
  endDate,
  asOfDate,
  onChange,
  className = '',
}) {
  const activeQuick = useMemo(() => {
    if (mode !== 'range') return null;
    for (const b of QUICK_BUTTONS) {
      const r = getQuickRange(b.id);
      if (r && r.startDate === startDate && r.endDate === endDate) return b.id;
    }
    return null;
  }, [mode, startDate, endDate]);

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
        {QUICK_BUTTONS.map((b) => (
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
