'use client';

import type { ReactNode } from 'react';
import DatePicker from './date-picker/DatePicker';
import { dateFromIso, isoFromDate } from '@/lib/utils/isoDate';

export interface DateFieldProps {
  label?: ReactNode;
  /** 'YYYY-MM-DD', or '' for no date. */
  value?: string | null;
  onChange?: (value: string) => void;
  /** Earliest / latest pickable day, 'YYYY-MM-DD'. */
  min?: string;
  max?: string;
  placeholder?: string;
  required?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  /** Classes for the wrapper (label + field). */
  containerClassName?: string;
}

/**
 * A single-date field for forms and filters. Same shape as the old
 * <Input type="date"> (string in, string out); the control is the animated
 * DatePicker.
 */
export default function DateField({
  label,
  value,
  onChange,
  min,
  max,
  placeholder = 'Select a date',
  required,
  error,
  hint,
  disabled,
  containerClassName,
}: DateFieldProps) {
  return (
    <DatePicker
      label={label}
      required={required}
      error={error}
      description={hint}
      placeholder={placeholder}
      disabled={disabled}
      className={containerClassName}
      value={dateFromIso(value)}
      minDate={dateFromIso(min)}
      maxDate={dateFromIso(max)}
      onChange={(date) => onChange?.(isoFromDate(date))}
      locale="en-GB"
      format={{ day: 'numeric', month: 'short', year: 'numeric' }}
      showToday
    />
  );
}
