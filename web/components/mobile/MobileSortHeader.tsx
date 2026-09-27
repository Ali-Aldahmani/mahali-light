'use client';

import { cn } from '@/lib/utils/cn';

export type SortState<K extends string> = { key: K; direction: 'asc' | 'desc' } | null;

export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

/** Orders the rows already on screen — a view preference, not a query. */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, value: (row: T, key: K) => unknown) {
  if (!sort) return rows;
  const out = [...rows].sort((a, b) => {
    const av = value(a, sort.key);
    const bv = value(b, sort.key);
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
  });
  return sort.direction === 'desc' ? out.reverse() : out;
}

export default function MobileSortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
}) {
  const active = sort?.key === sortKey;
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('flex', align === 'right' ? 'justify-end' : 'justify-start')}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex min-h-[40px] items-center gap-1 font-m-inter text-[12px] font-semibold tracking-[0.3px] active:opacity-60',
          active ? 'text-ink' : 'text-ink-muted',
        )}
      >
        {label}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/mobile/sort.svg"
          alt=""
          aria-hidden
          className={cn('h-3 w-3', active && sort!.direction === 'desc' && 'rotate-180')}
        />
      </button>
    </div>
  );
}
