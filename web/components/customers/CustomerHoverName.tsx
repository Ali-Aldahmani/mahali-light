'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HoverCard, HoverCardProfile } from '@/components/ui/hover-card';
import Avatar from '@/components/ui/Avatar';
import { getCustomerSummary } from '@/services/customerService';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import Skeleton from '@/components/ui/skeleton';

interface CustomerSummary {
  id: string;
  name: string;
  phone?: string | null;
  companyName?: string | null;
  totalSpent: number;
  invoiceCount: number;
  /** Only sent to users who may see balances. */
  creditBalance?: number;
  lastPayment: { date: string; amount: number; method: string; source: 'invoice' | 'balance' } | null;
}

// Summaries are small and change rarely while someone browses a list, so a
// short cache keeps hovering back and forth instant without going stale.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: CustomerSummary }>();
const inflight = new Map<string, Promise<CustomerSummary>>();

function loadSummary(id: string): Promise<CustomerSummary> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data);
  const pending = inflight.get(id);
  if (pending) return pending;
  const request = (getCustomerSummary(id) as Promise<CustomerSummary>)
    .then((data) => {
      cache.set(id, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, request);
  return request;
}

function SummaryCard({ id, name }: { id: string; name: string }) {
  const cached = cache.get(id);
  const [data, setData] = useState<CustomerSummary | null>(cached && Date.now() - cached.at < TTL_MS ? cached.data : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSummary(id)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);

  if (!data) {
    return (
      failed ? (
        <div className="flex items-center gap-3">
          <Avatar name={name} size="md" />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-ink">{name}</div>
            <div className="text-xs text-error">Couldn&apos;t load customer details.</div>
          </div>
        </div>
      ) : (
        <Skeleton lines={4} avatar label={`Loading ${name}`} />
      )
    );
  }

  const balance = data.creditBalance ?? 0;
  const stats = [{ label: 'Total spent', value: formatCurrency(data.totalSpent) }];
  if (balance > 0) stats.push({ label: 'Balance', value: formatCurrency(balance) });

  return (
    <HoverCardProfile
      name={data.name}
      role={data.phone || 'No phone number'}
      avatar={<Avatar name={data.companyName || data.name} size="md" />}
      stats={stats}
      meta={
        data.lastPayment ? (
          <>
            Last paid <span className="font-medium text-ink">{formatCurrency(data.lastPayment.amount)}</span> on{' '}
            <span className="font-medium text-ink">{formatDate(data.lastPayment.date)}</span>
          </>
        ) : (
          'No payments yet'
        )
      }
    />
  );
}

/**
 * A customer's name that shows a summary card while the mouse rests on it:
 * name, phone, total spent, balance (when they owe), and their last payment.
 * Falls back to plain text for guests and for users who can't view customers.
 */
export default function CustomerHoverName({
  id: rawId,
  name,
  fallback = 'Guest',
  href,
  className,
}: {
  id?: string | number | null;
  name?: string | null;
  fallback?: string;
  /** Render the name as a link (detail pages), still with the hover card. */
  href?: string;
  className?: string;
}) {
  const canView = useAuthStore((s) => s.hasPermission('customer.view'));
  const label = name || fallback;
  const id = rawId == null || rawId === '' ? null : String(rawId);
  if (!id || !canView) {
    return href && id ? <Link href={href} className={className}>{label}</Link> : <span className={className}>{label}</span>;
  }
  // Start loading as the pointer arrives, so the card opens with its numbers.
  const prefetch = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') loadSummary(id).catch(() => {});
  };

  return (
    <HoverCard content={<SummaryCard id={id} name={label} />}>
      {href ? (
        <Link href={href} onPointerEnter={prefetch} className={className}>
          {label}
        </Link>
      ) : (
        <span
          onPointerEnter={prefetch}
          className={cn('cursor-default underline decoration-dotted decoration-ink-muted/50 underline-offset-[3px]', className)}
        >
          {label}
        </span>
      )}
    </HoverCard>
  );
}
