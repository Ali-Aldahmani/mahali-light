'use client';

import type { ReactNode } from 'react';
import SelectField from './select-field/SelectField';

export interface SelectOption {
  value: any;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  label?: ReactNode;
  value?: any;
  onChange?: (value: any, option: SelectOption) => void;
  options?: SelectOption[];
  placeholder?: string;
  /** Kept for compatibility. The list supports type-to-jump instead of a search box. */
  searchable?: boolean;
  error?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** Classes for the trigger. */
  className?: string;
  /** Classes for the wrapper (label + trigger + hint). */
  containerClassName?: string;
  /** Kept for compatibility (shown only by the old searchable list). */
  emptyLabel?: string;
}

/**
 * The app's single-select drop-down. Same props it always had; the control
 * itself is the animated Radix select in ./select-field.
 *
 * Radix needs non-empty string values, while our options carry any value
 * ('' for "All", numbers, ids...). So options are addressed by position and
 * translated back to the original value and option in onChange.
 */
export default function Select({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  error,
  hint,
  disabled = false,
  required = false,
  className,
  containerClassName,
}: SelectProps) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <SelectField
      label={label}
      description={hint}
      error={error}
      required={required}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      containerClassName={containerClassName}
      value={index >= 0 ? String(index) : ''}
      onValueChange={(key) => {
        const option = options[Number(key)];
        if (option) onChange?.(option.value, option);
      }}
      options={options.map((o, i) => ({
        value: String(i),
        label: o.label,
        hint: o.description,
        disabled: o.disabled,
      }))}
    />
  );
}
