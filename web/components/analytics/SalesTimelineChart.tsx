'use client';

import { motion } from 'motion/react';
import LineChart, {
  type LineChartDatum,
  type LineChartSeries,
} from '@/components/charts/line-chart';
import { formatDate, formatCurrency } from '@/lib/utils/format';
import { TIMEZONE } from '@/lib/config';
import { motionTokens } from '@/lib/motion-tokens';

const shortDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: 'short',
});

const compactTick = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function shortDate(value: unknown): string | undefined {
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) return undefined;
  return shortDateFormatter.format(date);
}

type RangeOption = { value: string; label: string };

// Revenue over time — this period's revenue per day with an optional faint
// "previous period" comparison line, now drawn by the animated LineChart.
// The card header carries the period total, the growth vs the previous
// period and (when given) the dashboard's range switch.
export default function SalesTimelineChart({
  rows = [],
  height = 240,
  showComparison = true,
  title = 'Revenue over time',
  totalLabel = 'Total revenue',
  total,
  growthPct,
  ranges,
  range,
  onRangeChange,
  loading = false,
}: {
  rows?: any[];
  height?: number;
  showComparison?: boolean;
  title?: string;
  totalLabel?: string;
  /** Period total; falls back to the sum of the plotted rows. */
  total?: number | null;
  /** % change vs the previous period, if the KPI endpoint provided one. */
  growthPct?: number | null;
  ranges?: RangeOption[];
  range?: string;
  onRangeChange?: (value: string) => void;
  loading?: boolean;
}) {
  const data: LineChartDatum[] = rows.map((r, index) => {
    const bucket =
      typeof r.bucket === 'string' ? r.bucket.slice(0, 10) : r.bucket;
    return {
      key: String(bucket ?? index),
      label: formatDate(r.bucket),
      axisLabel: shortDate(bucket),
      values: {
        revenue: Number(r.revenue) || 0,
        previous: Number(r.previous_revenue) || 0,
      },
    };
  });

  const series: LineChartSeries[] = [
    { key: 'revenue', label: 'This period', area: true },
    ...(showComparison
      ? [{ key: 'previous', label: 'Previous period', dashed: true, area: false }]
      : []),
  ];

  const headline =
    total != null && Number.isFinite(Number(total))
      ? Number(total)
      : data.reduce((sum, d) => sum + (d.values.revenue ?? 0), 0);
  const growth =
    growthPct != null && Number.isFinite(Number(growthPct)) ? Number(growthPct) : null;

  return (
    <div className="rounded-[20px] border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
        {ranges && ranges.length > 1 && onRangeChange && (
          <RangeSwitch options={ranges} value={range} onChange={onRangeChange} />
        )}
      </div>

      <div className="mt-4">
        <p className="text-xs text-ink-muted">{totalLabel}</p>
        <p className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight text-ink tabular-nums sm:text-[32px]">
          {formatCurrency(headline)}
        </p>
        {growth !== null && (
          <p className={`mt-1 text-sm tabular-nums ${growth >= 0 ? 'text-success' : 'text-error'}`}>
            {growth >= 0 ? '+' : '−'}
            {Math.abs(growth).toFixed(1)}% vs previous period
          </p>
        )}
      </div>

      <LineChart
        className="mt-5"
        data={data}
        series={series}
        label={title}
        height={height}
        categoryLabel="Date"
        loading={loading}
        formatValue={(value) => formatCurrency(value)}
        formatTick={(value) => compactTick.format(value)}
        emptyLabel="No sales data for the selected period."
      />
    </div>
  );
}

/** Segmented range buttons in the chart header (pill track, raised thumb). */
function RangeSwitch({
  options,
  value,
  onChange,
}: {
  options: RangeOption[];
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Chart period"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`relative h-8 rounded-full px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${on ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
          >
            {on && (
              <motion.span
                layoutId="revenue-chart-range"
                className="absolute inset-0 rounded-full bg-surface shadow-card"
                transition={motionTokens.spring.snappy}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
