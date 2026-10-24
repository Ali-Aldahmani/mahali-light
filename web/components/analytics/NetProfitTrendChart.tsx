import BarChart, { type BarChartDatum } from '@/components/charts/bar-chart';

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const amount = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });

// Daily net profit for one month on the Overview tab. Rows come straight from
// /analytics/net-profit-trends grouped by day; each bar is one day's net
// profit (revenue − COGS − expenses), with the month's daily average as the
// reference line.
export default function NetProfitTrendChart({ rows = [], period, height = 220 }: { rows?: any[]; period: string; height?: number }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
        No trend data yet for this month.
      </div>
    );
  }
  const data: BarChartDatum[] = rows.map((r) => {
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
    <div className="rounded-card border border-border bg-surface p-4">
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
    </div>
  );
}
