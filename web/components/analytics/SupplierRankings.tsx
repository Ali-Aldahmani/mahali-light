'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CalendarCheck, Tag, PackageCheck } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { getSupplierRankings } from '@/services/analyticsService';
import { formatCurrency } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type Tone = 'success' | 'warning' | 'error' | 'muted' | 'neutral' | 'accent';

const DELIVERY_TIERS: Record<string, { label: string; tone: Tone }> = {
  honest: { label: 'Honest', tone: 'success' },
  mid: { label: 'Mid', tone: 'warning' },
  low: { label: 'Low', tone: 'error' },
  insufficient: { label: 'Not enough data', tone: 'muted' },
};
const PRICE_TIERS: Record<string, { label: string; tone: Tone }> = {
  lowest: { label: 'Lowest', tone: 'success' },
  mid: { label: 'Mid', tone: 'warning' },
  expensive: { label: 'Expensive', tone: 'error' },
};
const VOLUME_TIERS: Record<string, { label: string; tone: Tone }> = {
  more: { label: 'Supplies more', tone: 'success' },
  mid: { label: 'Mid', tone: 'warning' },
  less: { label: 'Supplies less', tone: 'error' },
  single: { label: 'Only supplier', tone: 'muted' },
};

const qty = (n: number) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
const signedPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

function TierBadge({ map, tier }: { map: Record<string, { label: string; tone: Tone }>; tier: string }) {
  const t = map[tier] || { label: tier, tone: 'neutral' as Tone };
  return (
    <Badge tone={t.tone} size="sm" dot={t.tone !== 'muted'}>
      {t.label}
    </Badge>
  );
}

function Panel({
  icon,
  title,
  how,
  children,
}: {
  icon: ReactNode;
  title: string;
  how: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-surface shadow-card flex flex-col min-w-0">
      <header className="flex items-start gap-3 px-4 pt-4 pb-3 border-b border-border">
        <span className="h-8 w-8 shrink-0 rounded-md bg-accent-light text-accent flex items-center justify-center">
          {icon}
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink">{title}</h4>
          <p className="text-xs text-ink-muted mt-0.5">{how}</p>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-ink-muted">{children}</p>;
}

function Row({
  rank,
  name,
  metric,
  detail,
  badge,
  dim = false,
}: {
  rank: number;
  name: string;
  metric: ReactNode;
  detail: ReactNode;
  badge: ReactNode;
  dim?: boolean;
}) {
  return (
    <li className={cn('flex items-center gap-3 px-4 py-3', dim && 'opacity-70')}>
      <span
        className={cn(
          'h-6 w-6 shrink-0 rounded-full text-[11px] font-semibold flex items-center justify-center',
          rank === 1 && !dim ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted',
        )}
      >
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink truncate" title={name}>
            {name}
          </span>
          <span className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap">{metric}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-ink-muted truncate">{detail}</span>
          {badge}
        </div>
      </div>
    </li>
  );
}

export default function SupplierRankings({
  range,
}: {
  range: { start_date: string; end_date: string };
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    getSupplierRankings(range)
      .then((res: any) => alive && setData(res?.data || res))
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  const t = data?.thresholds;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">Supplier ranking</h3>
        <p className="text-xs text-ink-muted mt-0.5">
          Orders confirmed and items received in the selected period.
        </p>
      </div>

      {loading && !data ? (
        <div className="rounded-card border border-border bg-surface p-10 flex justify-center">
          <Spinner />
        </div>
      ) : failed ? (
        <div className="rounded-card border border-border bg-surface p-6 text-center text-sm text-ink-muted">
          Could not load supplier rankings.
        </div>
      ) : (
        <div
          className={cn(
            'grid gap-4 grid-cols-1 lg:grid-cols-3 transition-opacity',
            loading && 'opacity-60',
          )}
        >
          {/* 1. Expected vs real delivery date */}
          <Panel
            icon={<CalendarCheck className="h-4 w-4" />}
            title="Delivery honesty"
            how={`Promised vs real delivery date. Honest ≥ ${t?.honestOnTimePct ?? 90}% on time, Low < ${t?.midOnTimePct ?? 70}%.`}
          >
            {data?.delivery?.length ? (
              <ul className="divide-y divide-border">
                {data.delivery.map((r: any) => (
                  <Row
                    key={r.supplierId}
                    rank={r.rank}
                    name={r.supplierName}
                    dim={r.tier === 'insufficient'}
                    metric={`${r.onTimePct.toFixed(0)}% on time`}
                    detail={
                      <>
                        {r.onTime}/{r.evaluated} orders
                        {r.avgDaysLate > 0 && ` · avg ${r.avgDaysLate} d late`}
                        {r.openLate > 0 && (
                          <span className="text-error"> · {r.openLate} overdue</span>
                        )}
                      </>
                    }
                    badge={<TierBadge map={DELIVERY_TIERS} tier={r.tier} />}
                  />
                ))}
              </ul>
            ) : (
              <Empty>No orders due for delivery in this period.</Empty>
            )}
            {data?.delivery?.some((r: any) => r.tier === 'insufficient') && (
              <p className="px-4 pb-3 text-[11px] text-ink-muted">
                Rated after {t?.minDeliveries ?? 3} deliveries. Orders without an expected date use the
                supplier’s default lead time.
              </p>
            )}
          </Panel>

          {/* 2. Same items, compared on cost */}
          <Panel
            icon={<Tag className="h-4 w-4" />}
            title="Price on the same items"
            how="Cost vs the average of other suppliers for the same products."
          >
            {data?.price === null ? (
              <Empty>You don’t have permission to see cost prices.</Empty>
            ) : data?.price?.length ? (
              <>
                <ul className="divide-y divide-border">
                  {data.price.map((r: any) => (
                    <Row
                      key={r.supplierId}
                      rank={r.rank}
                      name={r.supplierName}
                      metric={
                        <span
                          className={cn(
                            r.tier === 'lowest' && 'text-success',
                            r.tier === 'expensive' && 'text-error',
                          )}
                        >
                          {signedPct(r.pricePct)}
                        </span>
                      }
                      detail={`${r.sharedItems} shared item${r.sharedItems === 1 ? '' : 's'} · cheapest on ${r.cheapestOn}`}
                      badge={<TierBadge map={PRICE_TIERS} tier={r.tier} />}
                    />
                  ))}
                </ul>
                {data.priceNotComparable?.length > 0 && (
                  <p className="px-4 pb-3 text-[11px] text-ink-muted">
                    No shared items to compare: {data.priceNotComparable.join(', ')}.
                  </p>
                )}
              </>
            ) : (
              <Empty>
                Needs the same product received from at least two suppliers in this period.
              </Empty>
            )}
          </Panel>

          {/* 3. How much each supplier delivered */}
          <Panel
            icon={<PackageCheck className="h-4 w-4" />}
            title="Volume delivered"
            how="Quantity actually received, ranked against the other suppliers."
          >
            {data?.volume?.length ? (
              <ul className="divide-y divide-border">
                {data.volume.map((r: any) => (
                  <Row
                    key={r.supplierId}
                    rank={r.rank}
                    name={r.supplierName}
                    dim={r.tier === 'single'}
                    metric={`${qty(r.quantity)} unit${r.quantity === 1 ? '' : 's'}`}
                    detail={
                      <>
                        {r.products} product{r.products === 1 ? '' : 's'}
                        {r.value != null && ` · ${formatCurrency(r.value)}`}
                      </>
                    }
                    badge={<TierBadge map={VOLUME_TIERS} tier={r.tier} />}
                  />
                ))}
              </ul>
            ) : (
              <Empty>No items received in this period.</Empty>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
