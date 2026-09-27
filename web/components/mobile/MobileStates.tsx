'use client';

import Link from 'next/link';
import { AlertCircle, Inbox, Lock, Monitor, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { MOBILE_HOME } from '@/lib/mobile/routePolicy';

export const DESKTOP_REQUIRED_TITLE = 'Desktop required';
export const DESKTOP_REQUIRED_MESSAGE =
  'This feature is currently available on the desktop version of Edara. Open Edara on a desktop to continue.';
export const PERMISSION_DENIED_MESSAGE = "You don't have permission to access this feature.";

export function MobileCard({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-[12px] border border-m-line bg-white', className)} {...rest}>
      {children}
    </div>
  );
}

export function MobileSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-[12px] bg-white border border-m-line', className)} />;
}

export function MobileLoading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <MobileSkeleton key={i} className="h-[72px]" />
      ))}
    </div>
  );
}

export function MobileEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <MobileCard className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-m-field text-ink-muted">
        <Inbox size={22} aria-hidden />
      </span>
      <p className="mt-3 font-m-inter text-[14px] font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 font-m-inter text-[12px] text-ink-muted">{description}</p>}
    </MobileCard>
  );
}

export function MobileError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <MobileCard role="alert" className="flex flex-col items-center px-6 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-light text-error">
        <AlertCircle size={22} aria-hidden />
      </span>
      <p className="mt-3 font-m-inter text-[14px] text-ink">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-[14px] border border-m-line bg-white px-5 font-m-work text-[14px] font-medium text-m-accent active:bg-m-field"
        >
          <RefreshCw size={16} aria-hidden />
          Try again
        </button>
      )}
    </MobileCard>
  );
}

/** Inline notice for a section the user's role can't see (e.g. a dashboard card). */
export function MobilePermissionNote({ className }: { className?: string }) {
  return (
    <MobileCard className={cn('flex items-center gap-3 p-4', className)}>
      <Lock size={18} className="shrink-0 text-ink-muted" aria-hidden />
      <p className="font-m-inter text-[13px] text-ink-muted">{PERMISSION_DENIED_MESSAGE}</p>
    </MobileCard>
  );
}

function FullScreenNotice({
  icon,
  title,
  message,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  testId: string;
}) {
  return (
    <section data-testid={testId} className="flex min-h-[60vh] flex-col items-center justify-center px-2 text-center">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[18px] bg-m-field text-ink">
        {icon}
      </span>
      <h1 className="mt-6 font-m-work text-[22px] font-semibold text-ink">{title}</h1>
      <p className="mt-2 max-w-[320px] font-m-work text-[14px] leading-relaxed text-ink-muted">{message}</p>
      <Link
        href={MOBILE_HOME}
        className="mt-8 flex h-[52px] w-full max-w-[392px] items-center justify-center rounded-[14px] bg-m-accent font-m-work text-[14px] font-semibold text-white active:opacity-80"
      >
        Go to dashboard
      </Link>
    </section>
  );
}

export function DesktopRequiredScreen() {
  return (
    <FullScreenNotice
      testId="desktop-required"
      icon={<Monitor size={30} aria-hidden />}
      title={DESKTOP_REQUIRED_TITLE}
      message={DESKTOP_REQUIRED_MESSAGE}
    />
  );
}

export function PermissionDeniedScreen() {
  return (
    <FullScreenNotice
      testId="permission-denied"
      icon={<Lock size={30} aria-hidden />}
      title="Access restricted"
      message={PERMISSION_DENIED_MESSAGE}
    />
  );
}
