'use client';

import { forwardRef } from 'react';
import type { FocusEvent } from 'react';
import { PhoneInput } from './phone-input';
import type { PhoneInputDetails } from './phone-input';
import { toE164 } from '@/lib/utils/phone';

/**
 * The app's phone field: PhoneInput with UAE as the default country.
 * Reads any stored format (+971…, 00971…, 050…) and always writes the
 * international form, such as "+971501234567" ('' when empty).
 */
const PhoneField = forwardRef<
  HTMLInputElement,
  {
    label: string;
    value?: string | null;
    onChange: (value: string, details?: PhoneInputDetails) => void;
    error?: string;
    description?: string;
    required?: boolean;
    disabled?: boolean;
    hideLabel?: boolean;
    className?: string;
    id?: string;
    onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  }
>(function PhoneField({ value, onChange, error, ...rest }, ref) {
  return (
    <PhoneInput
      ref={ref}
      {...rest}
      value={toE164(value)}
      error={error || undefined}
      onValueChange={(next, details) => onChange(next, details)}
    />
  );
});

export default PhoneField;
