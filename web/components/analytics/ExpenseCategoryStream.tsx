'use client';

import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Streamgraph, { type StreamgraphDatum, type StreamgraphSeries } from '@/components/charts/streamgraph';
import { getExpenseCategoryMonthly } from '@/services/analyticsService';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const amount = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });
/** Layers past this many fold into "Other", so the stream stays readable. */
const MAX_LAYERS = 6;

// Bills & expenses per expense category, month by month, for one year.
// Year buttons sit top right; the current year only runs up to this month.
export default function ExpenseCategoryStream() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [result, setResult] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    getExpenseCategoryMonthly({ year })
      .then((r: any) => setResult(r?.data || r))
      .catch(() => {
        setResult(null);
        setFailed(true);
      });
  }, [year]);

  const years: number[] = result?.years?.length ? result.years : [thisYear];

  const { series, data } = useMemo(() => {
    const categories: any[] = result?.categories || [];
    const kept = categories.length > MAX_LAYERS ? categories.slice(0, MAX_LAYERS - 1) : categories;
    const rest = categories.slice(kept.length);
    const layers = rest.length
      ? [...kept, { key: '__other', name: 'Other', months: MONTH.map((_, m) => rest.reduce((sum, c) => sum + (c.months[m] || 0), 0)) }]
      : kept;
    const months = result?.year === thisYear ? new Date().getMonth() + 1 : 12;
    return {
      series: layers.map((c): StreamgraphSeries => ({ key: c.key, label: c.name })),
      data: !layers.length
        ? []
        : MONTH.slice(0, months).map((short, m): StreamgraphDatum => ({
            key: `${result.year}-${m + 1}`,
            label: `${MONTH_LONG[m]} ${result.year}`,
            axisLabel: short,
            values: Object.fromEntries(layers.map((c) => [c.key, c.months[m] || 0])),
          })),
    };
  }, [result, thisYear]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-ink">Bills &amp; expenses by category</h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Year">
          {years.map((y) => (
            <Button
              key={y}
              variant={y === year ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={y === year}
              onClick={() => setYear(y)}
            >
              {y}
            </Button>
          ))}
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface p-4">
        <Streamgraph
          data={data}
          series={series}
          label={`Bills & expenses by category, ${year}`}
          unit="AED"
          height={260}
          categoryLabel="Month"
          emptyLabel={failed ? 'Could not load bills & expenses' : result ? `No bills or expenses paid in ${year}` : 'Loading…'}
          formatValue={(v) => amount.format(v)}
        />
      </div>
    </div>
  );
}
