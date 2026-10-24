'use client';

import { useEffect, useMemo, useState } from 'react';
import BrushChart, { type BrushChartDatum } from '@/components/charts/brush-chart';
import { getDailyInvoiceCounts } from '@/services/analyticsService';

const DAY = 86_400_000;
/** The window opens on the latest stretch; drag the strip below to see the rest of the history. */
const OPEN_DAYS = 90;

// Confirmed invoices per day for the Overview tab, from the first sale (up to
// two years back) to today. Dates arrive as YYYY-MM-DD and are read as UTC
// midnights, which is what the brush chart formats.
export default function DailyInvoicesBrush() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getDailyInvoiceCounts({ days: 730 })
      .then((r: any) => setRows(r?.data || r || []))
      .catch(() => {
        setRows([]);
        setFailed(true);
      });
  }, []);

  const data: BrushChartDatum[] = useMemo(
    () => (rows || []).map((r) => ({ date: Date.parse(`${r.date}T00:00:00Z`), value: Number(r.invoices) || 0 })),
    [rows],
  );
  const lastT = data.length ? (data[data.length - 1]!.date as number) : 0;
  const firstT = data.length ? (data[0]!.date as number) : 0;
  const defaultRange: [number, number] | undefined =
    data.length && lastT - firstT > OPEN_DAYS * DAY ? [lastT - OPEN_DAYS * DAY, lastT] : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-[32px] flex-wrap items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-ink">Daily new invoices</h3>
        <span className="text-xs text-ink-muted">Drag the strip below to zoom</span>
      </div>
      <div className="flex-1 rounded-card border border-border bg-surface p-4">
        {/* Keyed on the loaded series so the window opens on the latest days once data arrives. */}
        <BrushChart
          key={data.length ? `${firstT}-${lastT}` : 'empty'}
          data={data}
          label="Daily new invoices"
          formatValue={(v) => `${Math.round(v)} invoice${Math.round(v) === 1 ? '' : 's'}`}
          formatTick={(v) => String(v)}
          defaultRange={defaultRange}
          height={200}
          overviewHeight={48}
          emptyLabel={failed ? 'Could not load invoices' : rows ? 'Not enough sales history yet' : 'Loading…'}
        />
      </div>
    </div>
  );
}
