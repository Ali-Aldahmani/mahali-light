'use client';

import Link from 'next/link';
import { ArrowRight, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const TOOLTIP = 'Open the full-screen cashier workspace';

/**
 * Primary entry point into the full-screen cashier workspace.
 * - Always a single line (never wraps, never shrinks in a crowded header).
 * - `compact` matches the 36px height of the header controls (search bar etc.).
 */
export default function CashierModeEntry({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/cashier"
      title={TOOLTIP}
      aria-label="Enter Cashier Mode"
      className={cn(
        'group inline-flex shrink-0 items-center whitespace-nowrap rounded-input',
        'bg-accent font-semibold text-white shadow-sm shadow-accent/30',
        'transition-[background-color,box-shadow,transform] duration-150',
        'hover:bg-accent-hover hover:shadow-md hover:shadow-accent/30',
        'active:scale-[0.97]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
        compact ? 'h-9 gap-2 pl-2.5 pr-3 text-[13px]' : 'h-10 gap-2.5 pl-3 pr-4 text-sm',
        className,
      )}
    >
      <Monitor className={compact ? 'h-4 w-4' : 'h-[18px] w-[18px]'} strokeWidth={2.25} aria-hidden />
      <span className="hidden sm:inline">Cashier Mode</span>
      <ArrowRight
        className="-ml-0.5 h-3.5 w-3.5 opacity-80 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  );
}
