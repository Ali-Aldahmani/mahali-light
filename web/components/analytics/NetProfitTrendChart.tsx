import type { ReactNode } from 'react';
import BarChart, { type BarChartDatum } from '@/components/charts/bar-chart';

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const amount = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });

// Daily net profit for one month on the Overview tab. Rows come straight from
// /analytics/net-profit-trends grouped by day; each bar is one day's net
// profit (revenue − COGS − expenses), with the month's daily average as the
// reference line. `action` sits top right of the card — the month picker —
// and stays there when the month has no data, so the user can switch back.
export default function NetProfitTrendChart({ rows = [], period, action, height = 220 }: { rows?: any[]; period: string; action?: ReactNode; height?: number }) {
  const data: BarChartDatum[] = (Array.isArray(rows) ? rows : []).map((r) => {
    const key = typeof r.bucket === 'string' ? r.bucket.slice(0, 10) : String(r.bucket);
    const date = new Date(`${key}T00:00:00Z`);
    return {
      key,
      label: WEEKDAY.format(date),
      axisLabel: String(date.getUTCDate()),
      value: Number(r.net_profit) || 0,
    };
  });
  return (
    <div className="h-full rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-ink">Net profit trend</h3>
        {action}
      </div>
      {data.length === 0 ? (
        <div className="py-16 text-center text-sm text-ink-muted">No trend data yet for {period || 'this month'}.</div>
      ) : (
        <BarChart
          data={data}
          label="Net profit"
          period={period}
          unit="AED"
          averageLabel="Daily average"
          valueLabel="Net profit"
          categoryLabel="Day"
          height={height}
          formatValue={(v) => amount.format(v)}
        />
      )}
    </div>
  );
}
