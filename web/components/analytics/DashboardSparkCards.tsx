'use client';

import Sparkline from '@/components/ui/sparkline';
import { formatCurrency } from '@/lib/utils/format';

interface Series {
  days: string[];
  revenue: number[];
  net_profit: number[];
  receivables: number[];
  payables: number[];
}

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const money = (n: number) => formatCurrency(n);
const pct = (n: number | null | undefined) => {
  const v = Number(n || 0);
  return `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`;
};

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-card border border-border bg-surface p-4 shadow-soft min-w-0">{children}</div>;
}

/**
 * The dashboard's five headline cards as sparklines. Hover or use the arrow
 * keys on a chart to read any day; the headline switches to that day's figure.
 */
export default function DashboardSparkCards({
  snapshot,
  kpis,
  series,
  todaySeries,
  periodLabel,
}: {
  snapshot: any;
  kpis: any;
  series: Series | null;
  todaySeries: { value: number; label: string }[];
  periodLabel: string;
}) {
  const labels = series?.days.map(dayLabel) ?? [];
  const growth = Number(kpis?.revenue_growth_pct || 0);
  const todayGrowth = Number(snapshot?.revenue_growth_pct || 0);
  const profit = Number(kpis?.net_profit || 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <Card>
        <Sparkline
          label="Today's revenue"
          value={money(snapshot?.today_revenue)}
          change={`${pct(todayGrowth)} vs yesterday · ${snapshot?.today_invoices ?? 0} invoices`}
          tone={todayGrowth < 0 ? 'danger' : 'accent'}
          data={todaySeries.map((d) => d.value)}
          labels={todaySeries.map((d) => dayLabel(String(d.label).slice(0, 10)))}
          formatValue={money}
        />
      </Card>
      <Card>
        <Sparkline
          label={`Revenue · ${periodLabel}`}
          value={money(kpis?.revenue)}
          change={`${pct(growth)} vs previous · ${kpis?.invoice_count || 0} invoices`}
          tone={growth < 0 ? 'danger' : 'accent'}
          data={series?.revenue ?? []}
          labels={labels}
          formatValue={money}
        />
      </Card>
      <Card>
        <Sparkline
          label="Receivables"
          value={money(kpis?.receivables_total)}
          change="Outstanding from customers"
          tone="warning"
          data={series?.receivables ?? []}
          labels={labels}
          formatValue={money}
        />
      </Card>
      <Card>
        <Sparkline
          label="Payables"
          value={money(kpis?.payables_total)}
          change="Outstanding to suppliers"
          tone="accent"
          data={series?.payables ?? []}
          labels={labels}
          formatValue={money}
        />
      </Card>
      <Card>
        <Sparkline
          label={`Net profit · ${periodLabel}`}
          value={money(profit)}
          change={`${Number(kpis?.net_margin_pct || 0).toFixed(1)}% margin`}
          tone={profit < 0 ? 'danger' : 'success'}
          data={series?.net_profit ?? []}
          labels={labels}
          formatValue={money}
        />
      </Card>
    </div>
  );
}
