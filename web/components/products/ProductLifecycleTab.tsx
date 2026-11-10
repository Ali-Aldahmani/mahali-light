'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import DateRangeField from '@/components/ui/DateRangeField';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import { formatCurrency, formatDate, formatDateTime, formatQty } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import {
  getLifecycleReceipts,
  getLifecycleSales,
  getLifecycleTimeline,
  getProductLifecycle,
} from '@/services/productLifecycleService';

// The product's life from purchase receipt to sale, return and what remains.
// Figures the user may not see (cost, profit, revenue, suppliers) are absent
// from the server's response, and their cards and columns are not shown.

const money = (v: any) => (v == null ? '—' : formatCurrency(v));
const num = (v: any) => (v == null ? '—' : formatQty(v));
const has = (v: any) => v !== undefined;

const SOURCE: Record<string, string> = {
  purchase_order: 'Purchase order',
  opening_balance: 'Stock before batches',
  opening_stock: 'Opening stock',
  product_create: 'Opening stock',
  variant_create: 'Opening stock',
  adjustment_direct: 'Adjustment',
  adjustment_request: 'Adjustment',
  return_order: 'Customer return',
  supplier_return: 'Supplier return',
};

const EVENT_LABELS: Record<string, string> = {
  purchase: 'Received',
  opening_stock: 'Opening stock',
  sale: 'Sold',
  return_in: 'Returned',
  exchange_return: 'Exchanged (returned)',
  return_out: 'Returned to supplier',
  adjustment: 'Adjusted',
  adjustment_in: 'Adjusted in',
  adjustment_out: 'Adjusted out',
  count_correction: 'Stock count',
  quarantine: 'Quarantined',
  quarantine_release: 'Released from quarantine',
  'variant.updated': 'Price or cost changed',
  'variant.cost_revalued': 'Cost corrected',
};

const TIMELINE_FILTERS = [
  { value: '', label: 'All events' },
  { value: 'purchase', label: 'Purchases & receipts' },
  { value: 'sale', label: 'Sales' },
  { value: 'return', label: 'Returns & exchanges' },
  { value: 'supplier_return', label: 'Supplier returns' },
  { value: 'adjustment', label: 'Adjustments & write-offs' },
  { value: 'quarantine', label: 'Quarantine' },
  { value: 'price_change', label: 'Price & cost changes' },
];

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-ink">{value}</div>
      {hint && <div className="text-[11px] text-ink-muted">{hint}</div>}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-ink-muted">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

const TH = 'px-3 py-2 text-left text-xs font-semibold text-ink-muted whitespace-nowrap';
const THR = `${TH} text-right`;
const TD = 'px-3 py-2 align-top';
const TDR = `${TD} text-right whitespace-nowrap`;

export default function ProductLifecycleTab({ productId, unitLabel = '' }: { productId: string; unitLabel?: string }) {
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [receipts, setReceipts] = useState<any>(null);
  const [receiptPage, setReceiptPage] = useState(1);
  const [sales, setSales] = useState<any>(null);
  const [salesPage, setSalesPage] = useState(1);
  const [timeline, setTimeline] = useState<any>(null);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineType, setTimelineType] = useState('');

  const params = { start_date: range.from || undefined, end_date: range.to || undefined };

  useEffect(() => {
    let live = true;
    setError(null);
    getProductLifecycle(productId, params)
      .then((d: any) => { if (live) setData(d); })
      .catch((e: any) => { if (live) setError(e?.message || 'Could not load the lifecycle.'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, range.from, range.to]);

  useEffect(() => {
    getLifecycleReceipts(productId, { page: receiptPage, limit: 20 }).then(setReceipts).catch(() => setReceipts(null));
  }, [productId, receiptPage]);

  useEffect(() => {
    getLifecycleSales(productId, { ...params, page: salesPage, limit: 20 }).then(setSales).catch(() => setSales(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, salesPage, range.from, range.to]);

  useEffect(() => {
    getLifecycleTimeline(productId, { ...params, page: timelinePage, limit: 25, types: timelineType || undefined })
      .then(setTimeline).catch(() => setTimeline(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, timelinePage, timelineType, range.from, range.to]);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-ink-muted">Loading the product lifecycle…</p>;

  const o = data.overview;
  const p = data.performance;
  const aging = data.aging;
  const maxBucket = Math.max(1, ...aging.buckets.map((b: any) => b.quantity));
  const u = unitLabel ? ` ${unitLabel}` : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-xs text-ink-muted">
          Sales figures are net of returns and all discounts, ex-VAT. COGS is the book cost at the weighted average;
          batch cost is what each cost group was bought at. Contribution is gross profit less card fees.
        </p>
        <DateRangeField
          label="Sales period"
          from={range.from}
          to={range.to}
          onChange={(r) => { setSalesPage(1); setTimelinePage(1); setRange({ from: r.from || '', to: r.to || '' }); }}
          className="w-full sm:w-72"
        />
      </div>

      <Section title="Overview">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="First received" value={o.firstReceivedAt ? formatDate(o.firstReceivedAt) : '—'} />
          <Stat label="Last received" value={o.lastReceivedAt ? formatDate(o.lastReceivedAt) : '—'} />
          <Stat label="Total received" value={`${num(o.totalReceived)}${u}`} />
          <Stat label="Sold" value={`${num(o.soldUnits)}${u}`} hint={`${num(o.netSoldUnits)} net of returns`} />
          <Stat label="Returned" value={`${num(o.returnedUnits)}${u}`} />
          <Stat label="Written off" value={`${num(o.writtenOff)}${u}`} hint="Damaged, lost or expired" />
          <Stat label="Available" value={`${num(o.available)}${u}`} hint={o.quarantined ? `${num(o.quarantined)} in quarantine` : undefined} />
          <Stat label="Reserved" value="—" hint="Not tracked: drafts hold no stock" />
          {has(o.inventoryValue) && <Stat label="Inventory value" value={money(o.inventoryValue)} hint="Book value" />}
          {has(o.revenue) && <Stat label="Net revenue" value={money(o.revenue)} />}
          {has(o.cogs) && <Stat label="COGS" value={money(o.cogs)} />}
          {has(o.grossProfit) && (
            <Stat label="Gross profit" value={money(o.grossProfit)}
              hint={o.grossMarginPct != null ? `${o.grossMarginPct}% margin` : undefined} />
          )}
          {has(o.paymentFees) && <Stat label="Card fees" value={money(o.paymentFees)} />}
          {has(o.contribution) && <Stat label="Contribution" value={money(o.contribution)} />}
        </div>
      </Section>

      <Section title="Cost groups and receipts">
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>Group</th>
                {has(data.costGroups[0]?.unitCost) && <th className={THR}>Unit cost</th>}
                <th className={THR}>Received</th>
                <th className={THR}>Sold</th>
                <th className={THR}>Returned</th>
                <th className={THR}>Remaining</th>
                {has(data.costGroups[0]?.revenue) && <th className={THR}>Revenue</th>}
                {has(data.costGroups[0]?.grossProfit) && <th className={THR}>Gross profit</th>}
                {has(data.costGroups[0]?.contribution) && <th className={THR}>Contribution</th>}
                <th className={THR}>Avg days to sale</th>
              </tr>
            </thead>
            <tbody>
              {data.costGroups.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-ink-muted">No receipts yet.</td></tr>
              )}
              {data.costGroups.map((g: any) => (
                <Fragment key={g.batchId}>
                  <tr className="border-t border-border">
                    <td className={TD}>
                      <button type="button" onClick={() => toggleGroup(g.batchId)} aria-expanded={openGroups.has(g.batchId)}
                        className="inline-flex items-center gap-1 font-mono text-ink hover:text-accent">
                        {openGroups.has(g.batchId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {g.batchNumber}
                      </button>
                      <div className="text-xs text-ink-muted">{g.sku} · {g.receipts.length} receipt{g.receipts.length === 1 ? '' : 's'}</div>
                    </td>
                    {has(g.unitCost) && <td className={TDR}>{money(g.unitCost)}</td>}
                    <td className={TDR}>{num(g.received)}</td>
                    <td className={TDR}>{num(g.sold)}</td>
                    <td className={TDR}>{num(g.returned)}</td>
                    <td className={TDR}>{num(g.remaining)}</td>
                    {has(g.revenue) && <td className={TDR}>{money(g.revenue)}</td>}
                    {has(g.grossProfit) && <td className={cn(TDR, g.grossProfit < 0 && 'text-error')}>{money(g.grossProfit)}</td>}
                    {has(g.contribution) && <td className={cn(TDR, g.contribution < 0 && 'text-error')}>{money(g.contribution)}</td>}
                    <td className={TDR}>{g.averageDaysToSale ?? '—'}</td>
                  </tr>
                  {openGroups.has(g.batchId) && g.receipts.map((r: any) => (
                    <tr key={r.receiptId} className="border-t border-border bg-surface-2/50 text-xs">
                      <td className={`${TD} pl-8`}>
                        {formatDate(r.receivedAt)} · {SOURCE[r.sourceType] || r.sourceType}
                        {r.poNumber && <> · <Link className="text-accent hover:underline" href={`/purchase-orders/${r.purchaseOrderId}`}>{r.poNumber}</Link></>}
                        {r.supplierName && <> · {r.supplierName}</>}
                      </td>
                      {has(g.unitCost) && <td className={TDR}>{money(r.unitCost)}</td>}
                      <td className={TDR}>{num(r.received)}</td>
                      <td className={TDR}>{num(r.sold)}</td>
                      <td className={TDR}>{num(r.returned)}</td>
                      <td className={TDR}>{num(r.remaining)}</td>
                      <td className={TD} colSpan={4}><span className="text-ink-muted">{r.daysInStock} days in stock</span></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Inventory aging and performance">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-card border border-border bg-surface p-3">
            <div className="mb-2 text-xs text-ink-muted">Units on hand by age of their receipt</div>
            <ul className="space-y-1.5">
              {aging.buckets.map((b: any) => (
                <li key={b.key} className="grid grid-cols-[90px_1fr_auto] items-center gap-2 text-xs">
                  <span className="text-ink-muted">{b.label}</span>
                  <span className="h-3 rounded bg-surface-2" aria-hidden>
                    <span className="block h-3 rounded bg-accent" style={{ width: `${(b.quantity / maxBucket) * 100}%` }} />
                  </span>
                  <span className="text-right text-ink">
                    {num(b.quantity)}{has(b.physicalValue) && <span className="text-ink-muted"> · {money(b.physicalValue)}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>Average age: <strong>{aging.averageAgeDays ?? '—'} days</strong></div>
              <div>Receipt to sale: <strong>{aging.averageDaysToSale ?? '—'} days</strong></div>
              <div className="col-span-2">
                Oldest remaining: {aging.oldestRemaining
                  ? <strong>{aging.oldestRemaining.batchNumber}, {aging.oldestRemaining.days} days ({num(aging.oldestRemaining.remaining)}{u})</strong>
                  : '—'}
              </div>
            </div>
          </div>
          <div className="rounded-card border border-border bg-surface p-3 text-xs">
            <div className="mb-2 text-ink-muted">{formatDate(p.period.startDate)} – {formatDate(p.period.endDate)} ({p.period.days} days)</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <dt className="text-ink-muted">Movement</dt>
              <dd className="font-semibold capitalize text-ink">{String(p.classification).replace('_', ' ')}</dd>
              <dt className="text-ink-muted">Sales velocity</dt><dd>{p.velocityPerDay}{u} / day</dd>
              <dt className="text-ink-muted">Days of cover</dt><dd>{p.daysOfCover ?? '—'}</dd>
              <dt className="text-ink-muted">Sell-through</dt><dd>{p.sellThroughPct != null ? `${p.sellThroughPct}%` : '—'}</dd>
              <dt className="text-ink-muted">Last sale</dt>
              <dd>{p.lastSaleAt ? `${formatDate(p.lastSaleAt)} (${p.daysSinceLastSale} days ago)` : 'Never'}</dd>
              {has(p.turnover) && (
                <>
                  <dt className="text-ink-muted">Turnover</dt>
                  <dd>{p.turnover ?? (p.turnoverNote === 'insufficient_history' ? 'Not enough history' : '—')}</dd>
                  <dt className="text-ink-muted">Net COGS / avg value</dt>
                  <dd>{money(p.netCogs)} / {money(p.averageValue)}</dd>
                </>
              )}
            </dl>
            <div className="mt-3 text-ink-muted">Stockouts</div>
            {data.stockouts.length === 0 ? (
              <p className="text-ink">None recorded.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {data.stockouts.slice(0, 5).map((s: any) => (
                  <li key={`${s.variantId}-${s.startedAt}`}>
                    {s.sku}: {formatDate(s.startedAt)} – {s.ongoing ? 'now' : formatDate(s.endedAt)} ({s.days} days)
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <Section title="Purchase and receiving history">
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>Received</th>
                <th className={TH}>Source</th>
                <th className={TH}>Group</th>
                {has(receipts?.rows?.[0]?.unitCost) && <th className={THR}>Unit cost</th>}
                <th className={THR}>Received qty</th>
                <th className={THR}>Remaining</th>
                <th className={THR}>Days in stock</th>
              </tr>
            </thead>
            <tbody>
              {(receipts?.rows || []).map((r: any) => (
                <tr key={r.receiptId} className="border-t border-border">
                  <td className={TD}>{formatDateTime(r.receivedAt)}{r.receivedBy && <div className="text-xs text-ink-muted">by {r.receivedBy}</div>}</td>
                  <td className={TD}>
                    {r.poNumber
                      ? <Link className="text-accent hover:underline" href={`/purchase-orders/${r.purchaseOrderId}`}>{r.poNumber}</Link>
                      : SOURCE[r.sourceType] || r.sourceType}
                    {r.supplierName && <div className="text-xs text-ink-muted">{r.supplierName}</div>}
                  </td>
                  <td className={`${TD} font-mono text-xs`}>{r.batchNumber}</td>
                  {has(r.unitCost) && <td className={TDR}>{money(r.unitCost)}</td>}
                  <td className={TDR}>{num(r.received)}</td>
                  <td className={TDR}>{num(r.remaining)}</td>
                  <td className={TDR}>{r.daysInStock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {receipts && <Pager page={receipts.page} limit={receipts.limit} total={receipts.total} onPage={setReceiptPage} />}
      </Section>

      <Section title="Sales history">
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>Invoice</th>
                <th className={THR}>Qty</th>
                <th className={THR}>Price</th>
                <th className={THR}>Discount</th>
                {has(sales?.rows?.[0]?.revenue) && <th className={THR}>Net revenue</th>}
                {has(sales?.rows?.[0]?.cogs) && <th className={THR}>COGS</th>}
                {has(sales?.rows?.[0]?.grossProfit) && <th className={THR}>Gross profit</th>}
                {has(sales?.rows?.[0]?.contribution) && <th className={THR}>Contribution</th>}
                <th className={TH}>From</th>
              </tr>
            </thead>
            <tbody>
              {sales?.rows?.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-muted">No sales in this period.</td></tr>
              )}
              {(sales?.rows || []).map((s: any) => (
                <tr key={s.lineId} className="border-t border-border">
                  <td className={TD}>
                    <Link className="text-accent hover:underline" href={`/invoices/${s.invoiceId}`}>{s.invoiceNumber}</Link>
                    <div className="text-xs text-ink-muted">{formatDateTime(s.soldAt)}</div>
                    {(s.returnedQuantity > 0 || s.isReplacement) && (
                      <div className="text-xs text-amber-700">
                        {s.isReplacement ? 'Exchange replacement' : `${num(s.returnedQuantity)} returned${s.exchanged ? ' (exchange)' : ''}`}
                      </div>
                    )}
                  </td>
                  <td className={TDR}>{num(s.quantity)}</td>
                  <td className={TDR}>{money(s.unitPrice)}</td>
                  <td className={TDR}>{s.discount ? money(s.discount) : '—'}</td>
                  {has(s.revenue) && <td className={TDR}>{money(s.revenue)}</td>}
                  {has(s.cogs) && <td className={TDR}>{money(s.cogs)}</td>}
                  {has(s.grossProfit) && <td className={cn(TDR, s.grossProfit < 0 && 'text-error')}>{money(s.grossProfit)}</td>}
                  {has(s.contribution) && <td className={cn(TDR, s.contribution < 0 && 'text-error')}>{money(s.contribution)}</td>}
                  <td className={`${TD} text-xs`}>
                    {s.allocations.length === 0 ? <span className="text-ink-muted">Before batch tracking</span> : (
                      <ul className="space-y-0.5">
                        {s.allocations.map((a: any, i: number) => (
                          <li key={`${a.receiptId}-${i}`}>
                            <span className="font-mono">{a.batchNumber}</span> × {num(a.quantity)}
                            {a.receivedAt && <span className="text-ink-muted"> · received {formatDate(a.receivedAt)}</span>}
                            {has(a.unitCost) && <span className="text-ink-muted"> · {money(a.unitCost)}</span>}
                            {a.returnedQuantity > 0 && <span className="text-amber-700"> · {num(a.returnedQuantity)} back</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sales && <Pager page={sales.page} limit={sales.limit} total={sales.total} onPage={setSalesPage} />}
      </Section>

      <Section
        title="Timeline"
        right={(
          <Select
            value={timelineType}
            onChange={(v: any) => { setTimelinePage(1); setTimelineType(v || ''); }}
            options={TIMELINE_FILTERS}
            className="min-w-[200px]"
            aria-label="Filter the timeline"
          />
        )}
      >
        <ol className="divide-y divide-border rounded-card border border-border bg-surface">
          {timeline?.rows?.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">No events.</li>}
          {(timeline?.rows || []).map((e: any) => (
            <li key={`${e.kind}-${e.id}`} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-ink">
                  {EVENT_LABELS[e.type] || e.type}
                  {e.quantity != null && <span className="ml-1 text-ink-muted">{e.quantity > 0 ? '+' : ''}{num(e.quantity)}{u}</span>}
                  {e.reason && <span className="ml-1 text-xs text-ink-muted">({e.reason})</span>}
                </div>
                <div className="text-xs text-ink-muted">
                  {formatDateTime(e.at)}{e.employee && <> · {e.employee}</>}{e.sku && <> · {e.sku}</>}
                  {e.link && <> · <Link className="text-accent hover:underline" href={e.link}>Open record</Link></>}
                </div>
                {e.batches?.length > 0 && (
                  <div className="text-xs text-ink-muted">
                    {e.batches.map((b: any, i: number) => (
                      <span key={i} className="mr-2 font-mono">{b.batchNumber} {b.onHandChange > 0 ? '+' : ''}{num(b.onHandChange || b.quarantineChange)}</span>
                    ))}
                  </div>
                )}
                {e.kind === 'price_change' && e.newValue && (
                  <div className="text-xs text-ink-muted">
                    {e.newValue.sellingPrice != null && <>Price {money(e.oldValue?.sellingPrice)} → {money(e.newValue.sellingPrice)} </>}
                    {e.newValue.costPrice != null && <>Cost {money(e.oldValue?.costPrice)} → {money(e.newValue.costPrice)}</>}
                  </div>
                )}
              </div>
              {has(e.valueChange) && e.valueChange != null && (
                <span className={cn('whitespace-nowrap text-xs', e.valueChange < 0 ? 'text-ink-muted' : 'text-ink')}>
                  {e.valueChange > 0 ? '+' : ''}{money(e.valueChange)} book
                </span>
              )}
            </li>
          ))}
        </ol>
        {timeline && <Pager page={timeline.page} limit={timeline.limit} total={timeline.total} onPage={setTimelinePage} />}
      </Section>
    </div>
  );
}
