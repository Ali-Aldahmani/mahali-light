import { useMemo } from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';
import Button from '../ui/Button.jsx';
import PeriodSelector, { REPORT_PRESETS } from '../ui/PeriodSelector.jsx';
import { cn } from '../../utils/cn.js';

// Reusable filter bar for the generic report page. Renders the date range
// quick-picker plus any extra filter slots passed in via `extras`.
//
// Each extra is a JSX node. The parent owns the state for those extras —
// this component only orchestrates the action buttons + layout.
export default function ReportFiltersBar({
  startDate,
  endDate,
  onPeriodChange,
  onRun,
  onReset,
  loading = false,
  extras = null,
  hidePeriod = false,
  className = '',
  presets = REPORT_PRESETS,
}) {
  const activeSummary = useMemo(() => {
    if (hidePeriod) return null;
    if (!startDate || !endDate) return 'No period selected';
    return `${startDate} → ${endDate}`;
  }, [startDate, endDate, hidePeriod]);

  return (
    <div
      className={cn(
        'card border border-border p-4 flex flex-col gap-3',
        className,
      )}
    >
      {!hidePeriod && (
        <PeriodSelector
          startDate={startDate}
          endDate={endDate}
          onChange={onPeriodChange}
          presets={presets}
        />
      )}
      {extras && (
        <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-border/60">
          {extras}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
        {activeSummary != null && (
          <p className="text-xs text-ink-muted">Range: {activeSummary}</p>
        )}
        <div className="flex gap-2 ml-auto">
          {onReset && (
            <Button variant="secondary" size="sm" leftIcon={<RotateCcw size={14} />} onClick={onReset}>
              Reset
            </Button>
          )}
          {onRun && (
            <Button
              variant="primary"
              size="sm"
              leftIcon={<RefreshCw size={14} />}
              loading={loading}
              onClick={onRun}
            >
              Run Report
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
