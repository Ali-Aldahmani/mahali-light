'use client';

import { useCallback, useRef } from 'react';
import DateRangePicker, { type DateRangePreset } from './date-range-picker/DateRangePicker';
import { dateFromIso, isoFromDate } from '@/lib/utils/isoDate';

export interface DateRangeFieldProps {
  /** 'YYYY-MM-DD', or '' for no bound. */
  from?: string | null;
  to?: string | null;
  onChange?: (range: { from: string; to: string }) => void;
  /** Accessible name; the trigger shows the dates. */
  label?: string;
  placeholder?: string;
  /** Shows a Clear button in the panel (filters). Defaults to true. */
  clearable?: boolean;
  min?: string;
  max?: string;
  presets?: DateRangePreset[];
  /** One or two months side by side. "auto" (default) picks two when the window is wide enough;
   *  use 1 inside narrow containers such as slide-overs. */
  months?: 'auto' | 1 | 2;
  className?: string;
}

/**
 * A from/to date range for filters and forms: strings in, strings out, like
 * the pairs of <Input type="date"> it replaces. The control is the animated
 * DateRangePicker. Clearing returns { from: '', to: '' }.
 */
export default function DateRangeField({
  from,
  to,
  onChange,
  label = 'Date range',
  placeholder = 'Any date',
  clearable = true,
  min,
  max,
  presets,
  months = 'auto',
  className,
}: DateRangeFieldProps) {
  // Keep the panel inside the nearest scrolling container (a slide-over, a
  // card with overflow) instead of only the window, so it is never clipped.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const boundary = useCallback(() => {
    let node = anchorRef.current?.parentElement ?? null;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll|hidden)/.test(style.overflowX + style.overflowY)) return node;
      node = node.parentElement;
    }
    return null;
  }, []);

  const start = dateFromIso(from);
  const end = dateFromIso(to);
  // A half-open legacy value (only one bound) is shown as that single day.
  const value = start || end ? { start: (start ?? end)!, end: (end ?? start)! } : null;
  return (
    <span ref={anchorRef} className="contents">
    <DateRangePicker
      label={label}
      placeholder={placeholder}
      clearable={clearable}
      value={value}
      minDate={dateFromIso(min)}
      maxDate={dateFromIso(max)}
      presets={presets}
      months={months}
      boundary={boundary}
      className={className}
      locale="en-GB"
      onChange={(range) =>
        onChange?.(range ? { from: isoFromDate(range.start), to: isoFromDate(range.end) } : { from: '', to: '' })
      }
    />
    </span>
  );
}
