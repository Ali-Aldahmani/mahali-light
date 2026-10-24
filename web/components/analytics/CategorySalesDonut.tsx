import DonutChart, { type DonutChartDatum } from '@/components/charts/donut-chart';

const amount = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });

// Sales revenue split by product category for the Overview tab. Rows come
// from /analytics/category-breakdown; the donut folds the smallest
// categories into "Other" and the legend toggles each one.
export default function CategorySalesDonut({ rows = [] }: { rows?: any[] }) {
  const data: DonutChartDatum[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    key: r.category_name || 'Uncategorised',
    label: r.category_name || 'Uncategorised',
    value: Number(r.revenue) || 0,
  }));
  return (
    <div className="h-full rounded-card border border-border bg-surface p-4">
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
