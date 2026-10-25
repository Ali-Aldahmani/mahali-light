import DonutChart, { type DonutChartDatum } from '@/components/charts/donut-chart';

const amount = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });

// Sales revenue split by product category for the Overview tab. Rows come
// from /analytics/category-breakdown; the donut folds the smallest
// categories into "Other" and the legend toggles each one.
export default function CategorySalesDonut({ rows = [], period }: { rows?: any[]; period?: string }) {
  const data: DonutChartDatum[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    key: r.category_name || 'Uncategorised',
    label: r.category_name || 'Uncategorised',
    value: Number(r.revenue) || 0,
  }));
  return (
    <div className="h-full rounded-card border border-border bg-surface p-4">
      {/* Same height as the net profit card's header, which holds the month picker this follows. */}
      <div className="flex min-h-[38px] flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-ink">Sales by category</h3>
        {period && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">{period}</span>}
      </div>
      <DonutChart
        data={data}
        label="Sales by category"
        unit="AED"
        totalLabel="Total sales"
        emptyLabel="No sales yet"
        size={200}
        thickness={22}
        formatValue={(v) => amount.format(v)}
      />
    </div>
  );
}
