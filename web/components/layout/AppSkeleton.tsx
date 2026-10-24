'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';

// Loading placeholders shaped like the real app: the sidebar, the header and
// a page body that matches the route, so the first paint already sits where
// the content will land instead of a lone card in the middle of the screen.

/** One grey block. Pulses unless the viewer prefers reduced motion. */
export function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" style={style} className={cn('block rounded-md bg-border animate-pulse motion-reduce:animate-none', className)} />;
}

function Card({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cn('rounded-card border border-border bg-surface', className)}>{children}</div>;
}

const NAV_GROUPS = [2, 3, 3, 2, 4, 2, 5];

function SidebarSkeleton() {
  // Same saved preference the real sidebar reads, so the width doesn't jump when it mounts.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('mahali.sidebarCollapsed') === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <aside className={cn('shrink-0 border-r border-border bg-surface flex flex-col', collapsed ? 'w-[72px]' : 'w-64')}>
      <div className={cn('flex items-center gap-2 py-5 border-b border-border', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Bone className="h-9 w-9 rounded-lg" />
        {!collapsed && (
          <div className="flex-1 space-y-1.5">
            <Bone className="h-3.5 w-28" />
            <Bone className="h-3 w-20" />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-hidden px-2 py-4 space-y-1">
        {NAV_GROUPS.map((count, group) => (
          <div key={group} className="space-y-1">
            {group > 0 && !collapsed && <Bone className="mx-3 mt-4 mb-2 h-2.5 w-16" />}
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className={cn('flex items-center gap-3 py-2', collapsed ? 'justify-center' : 'px-3')}>
                <Bone className="h-4 w-4 rounded" />
                {!collapsed && <Bone className={cn('h-3', i % 2 ? 'w-20' : 'w-24')} />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

function HeaderSkeleton() {
  return (
    <div className="h-16 shrink-0 border-b border-border bg-surface px-6 flex items-center justify-between">
      <Bone className="h-4 w-28" />
      <div className="flex items-center gap-3">
        <Bone className="hidden md:block h-9 w-72 rounded-lg" />
        <Bone className="h-9 w-32 rounded-lg" />
        <Bone className="h-9 w-24 rounded-full" />
        <Bone className="h-8 w-8 rounded-full" />
        <Bone className="h-8 w-24 rounded-full" />
      </div>
    </div>
  );
}

function TitleSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Bone className="h-7 w-40" />
      <Bone className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** Analytics → Overview below the period bar: KPI cards, net profit with the category donut, then bills & invoices. */
export function AnalyticsOverviewSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading analytics">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }, (_, i) => (
          <Card key={i} className="p-4 space-y-3">
            <Bone className="h-3 w-24" />
            <Bone className="h-6 w-20" />
          </Card>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Bone className="h-4 w-56" />
          <Bone className="h-9 w-56 rounded-lg" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="p-4">
            <Bone className="h-3 w-24" />
            <Bone className="mt-2 h-7 w-20" />
            <Bone className="mt-2 h-3 w-16" />
            <div className="mt-6 flex h-[180px] items-end gap-2 border-b border-border">
              {[30, 55, 20, 70, 45, 85, 35, 60, 25, 75, 50, 40].map((h, i) => (
                <Bone key={i} className="flex-1 rounded-b-none" style={{ height: `${h}%` }} />
              ))}
            </div>
          </Card>
          <Card className="p-4 flex flex-wrap items-center justify-center gap-6">
            <span aria-hidden="true" className="block h-[180px] w-[180px] rounded-full border-[22px] border-border animate-pulse motion-reduce:animate-none" />
            <div className="flex-1 min-w-[180px] space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Bone className="h-2.5 w-2.5 rounded-full" />
                  <Bone className="h-3 flex-1" />
                  <Bone className="h-3 w-10" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="flex min-h-[32px] items-center justify-between mb-2">
              <Bone className="h-4 w-48" />
              <Bone className="h-8 w-28 rounded-lg" />
            </div>
            <Card className="p-4">
              <Bone className="h-[260px] w-full rounded-xl" />
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <>
      <TitleSkeleton />
      <div className="mb-6 flex items-center gap-6 border-b border-border pb-3">
        {[20, 18, 18, 20, 20, 14, 22].map((w, i) => (
          <Bone key={i} className="h-4" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <Card className="p-3 mb-6 flex items-center gap-1.5">
        {[24, 24, 26, 26, 22].map((w, i) => (
          <Bone key={i} className="h-8 rounded-lg" style={{ width: `${w * 4}px` }} />
        ))}
        <Bone className="ml-auto h-9 w-40 rounded-lg" />
      </Card>
      <AnalyticsOverviewSkeleton />
    </>
  );
}

/** Most pages: a title, a toolbar and a table. */
function GenericPageSkeleton() {
  return (
    <div role="status" aria-label="Loading page">
      <TitleSkeleton />
      <Card className="p-3 mb-6 flex items-center gap-2">
        <Bone className="h-9 w-64 rounded-lg" />
        <Bone className="h-9 w-32 rounded-lg" />
        <Bone className="ml-auto h-9 w-28 rounded-lg" />
      </Card>
      <Card className="overflow-hidden">
        <div className="flex gap-6 border-b border-border bg-surface-2 px-4 py-3">
          {[32, 20, 24, 16, 20].map((w, i) => (
            <Bone key={i} className="h-3" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        {Array.from({ length: 8 }, (_, row) => (
          <div key={row} className="flex items-center gap-6 border-b border-border last:border-0 px-4 py-3.5">
            {[32, 20, 24, 16, 20].map((w, i) => (
              <Bone key={i} className="h-3" style={{ width: `${(w - (row % 3) * 2) * 4}px` }} />
            ))}
          </div>
        ))}
      </Card>
    </div>
  );
}

/** The page body for a route, for use inside the real dashboard shell. */
export function PageBodySkeleton({ pathname }: { pathname?: string | null }) {
  if (pathname?.startsWith('/analytics')) return <AnalyticsSkeleton />;
  return <GenericPageSkeleton />;
}

/** The whole app frame, for before the dashboard layout has mounted (first load, settings fetch). */
export function AppShellSkeleton({ pathname }: { pathname?: string | null }) {
  return (
    <div className="h-screen flex bg-bg" aria-busy="true">
      <SidebarSkeleton />
      <div className="flex-1 flex flex-col min-w-0">
        <HeaderSkeleton />
        <div className="flex-1 overflow-hidden px-8 py-6">
          <PageBodySkeleton pathname={pathname} />
        </div>
      </div>
    </div>
  );
}

/** Routes outside the dashboard shell (sign-in, first-run setup) keep a centred card. */
export function isShellRoute(pathname?: string | null) {
  return !!pathname && !['/login', '/setup'].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
