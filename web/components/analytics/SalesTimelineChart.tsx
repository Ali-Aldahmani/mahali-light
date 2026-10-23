'use client';

import LineChart, {
  type LineChartDatum,
  type LineChartSeries,
} from '@/components/charts/line-chart';
import { formatDate, formatCurrency } from '@/lib/utils/format';
import { TIMEZONE } from '@/lib/config';

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

// Revenue over time — this period's revenue per day with an optional faint
// "previous period" comparison line, now drawn by the animated LineChart.
export default function SalesTimelineChart({
  rows = [],
  height = 280,
  showComparison = true,
}: {
  rows?: any[];
  height?: number;
  showComparison?: boolean;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
        No sales data for the selected period.
      </div>
    );
  }

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

  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <LineChart
        data={data}
        series={series}
        label="Revenue over time"
        height={height}
        categoryLabel="Date"
        formatValue={(value) => formatCurrency(value)}
        formatTick={(value) => compactTick.format(value)}
        emptyLabel="No sales data for the selected period."
      />
    </div>
  );
}
