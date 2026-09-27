'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { sanitizeBarcodeInput, validateRetailBarcode } from '@/lib/mobile/barcode';
import { MOBILE_HOME } from '@/lib/mobile/routePolicy';
import { useMobileAddProductStore } from '@/store/mobileAddProductStore';
import MobileFlowHeader from '../MobileFlowHeader';
import { DETAILS_PATH } from './MobileScanBarcode';

export default function MobileManualBarcode() {
  const router = useRouter();
  const setBarcode = useMobileAddProductStore((s) => s.setBarcode);
  const reset = useMobileAddProductStore((s) => s.reset);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();
  const helpId = useId();

  function onContinue(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const check = validateRetailBarcode(value);
    if ('error' in check) {
      setError(check.error);
      return;
    }
    setSubmitting(true);
    setBarcode(check.code, 'manual');
    router.push(DETAILS_PATH);
  }

  function cancel() {
    reset();
    router.replace(MOBILE_HOME);
  }

  return (
    <form onSubmit={onContinue} noValidate className="flex flex-col font-m-work">
      <MobileFlowHeader title="Enter barcode manually" onBack={() => router.back()} />
      <p className="mt-8 px-3 text-[14px] text-ink-muted">Enter the number shown below the barcode.</p>

      <div className="mt-8 flex items-center gap-5 px-3">
        <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[18px] bg-m-field">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mobile/barcode.svg" alt="" aria-hidden className="h-8 w-8" />
        </span>
        <div>
          <p className="text-[14px] font-semibold text-ink">Tip</p>
          <p className="mt-1 text-[13px] text-ink-muted">Most product barcodes have 8 to 13 digits.</p>
        </div>
      </div>

      <label htmlFor={inputId} className="mt-12 px-3 text-[12px] font-medium text-ink-muted">
        Barcode number
      </label>
      <div className="mt-2 px-3">
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          autoFocus
          placeholder="e.g. 6291007029871"
          value={value}
          onChange={(e) => {
            setValue(sanitizeBarcodeInput(e.target.value));
            if (error) setError(null);
          }}
          aria-invalid={!!error}
          aria-describedby={helpId}
          className={cn(
            'h-[52px] w-full rounded-[14px] border bg-white px-4 text-[16px] tracking-wide text-ink placeholder:text-m-hint outline-none focus:border-m-accent',
            error ? 'border-error' : 'border-m-line',
          )}
        />
        <p id={helpId} role={error ? 'alert' : undefined} className={cn('mt-3 text-[12px]', error ? 'text-error' : 'text-ink-muted')}>
          {error || 'Numbers only'}
        </p>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mx-3 mt-24 flex h-[52px] items-center justify-center rounded-[14px] bg-m-accent text-[14px] font-semibold text-white active:opacity-80 disabled:opacity-70"
      >
        Continue
      </button>
      <button
        type="button"
        onClick={cancel}
        className="mx-3 mt-3 flex h-12 items-center justify-center text-[14px] font-medium text-ink-muted active:opacity-60"
      >
        Cancel
      </button>
    </form>
  );
}
