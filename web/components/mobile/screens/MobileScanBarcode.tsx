'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { CAMERA_ERROR_MESSAGES, type ScannerDeps } from '@/lib/mobile/scanner';
import { MOBILE_HOME } from '@/lib/mobile/routePolicy';
import { useMobileAddProductStore } from '@/store/mobileAddProductStore';
import MobileFlowHeader from '../MobileFlowHeader';

export const DETAILS_PATH = '/m/products/new/details';
export const MANUAL_PATH = '/m/products/new/manual';

export default function MobileScanBarcode({ scannerDeps }: { scannerDeps?: ScannerDeps } = {}) {
  const router = useRouter();
  const setBarcode = useMobileAddProductStore((s) => s.setBarcode);
  const reset = useMobileAddProductStore((s) => s.reset);
  const navigated = useRef(false);

  const { videoRef, status, error, retry } = useBarcodeScanner({
    deps: scannerDeps,
    onDetected: (code) => {
      if (navigated.current) return;
      navigated.current = true;
      setBarcode(code, 'camera');
      router.push(DETAILS_PATH);
    },
  });

  function cancel() {
    reset();
    router.replace(MOBILE_HOME);
  }

  const live = status === 'scanning';
  const canRetry = error === 'permission-denied' || error === 'unavailable';

  return (
    <div className="flex flex-col pb-2">
      <MobileFlowHeader title="Add new product" onBack={cancel} backSrc="/mobile/back-scan.svg" />

      <div className="mt-8 px-3">
        <h2 className="font-m-work text-[14px] font-semibold text-ink">Scan barcode</h2>
        <p className="mt-1 font-m-work text-[13px] text-ink-muted">Point your camera at the product barcode</p>
      </div>

      <div
        className="relative mx-3 mt-6 overflow-hidden rounded-[24px] bg-m-camera"
        style={{ height: 'min(472px, 56dvh)' }}
      >
        <video
          ref={videoRef}
          data-testid="scanner-video"
          muted
          playsInline
          autoPlay
          aria-label="Camera preview"
          className={live ? 'absolute inset-0 h-full w-full object-cover' : 'absolute inset-0 h-full w-full object-cover opacity-0'}
        />

        {status === 'error' && error ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <AlertCircle aria-hidden className="h-10 w-10 text-white/80" />
            <p className="mt-4 font-m-work text-[14px] leading-relaxed text-white">{CAMERA_ERROR_MESSAGES[error]}</p>
            {canRetry && (
              <button
                type="button"
                onClick={retry}
                className="mt-5 h-11 rounded-[14px] border border-white/40 px-5 font-m-work text-[14px] font-medium text-white active:bg-white/10"
              >
                Try again
              </button>
            )}
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8">
            {!live && (
              <div className="mb-[45px] flex flex-col items-center">
                {status === 'starting' ? (
                  <Loader2 aria-hidden className="h-12 w-12 animate-spin text-white" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/mobile/camera.svg" alt="" aria-hidden className="h-12 w-12" />
                )}
                <p className="mt-3 font-m-work text-[13px] text-white">
                  {status === 'paused' ? 'Camera paused' : 'Camera preview'}
                </p>
              </div>
            )}
            <div
              data-testid="scan-frame"
              className="h-[132px] w-full max-w-[328px] rounded-[16px] border-2 border-m-accent"
            />
            <p role="status" className="mt-[30px] font-m-work text-[13px] text-white">
              {status === 'detected' ? 'Barcode detected' : 'Align the barcode inside the frame'}
            </p>
          </div>
        )}
      </div>

      <p className="mt-8 text-center font-m-work text-[13px] text-ink-muted">
        The product details will be filled automatically.
      </p>

      <Link
        href={MANUAL_PATH}
        className="mx-3 mt-8 flex h-[52px] items-center justify-center rounded-[14px] border border-m-line bg-white font-m-work text-[14px] font-medium text-m-accent active:bg-m-field"
      >
        Enter barcode manually
      </Link>
      <button
        type="button"
        onClick={cancel}
        className="mx-3 mt-3 flex h-12 items-center justify-center font-m-work text-[14px] font-medium text-ink-muted active:opacity-60"
      >
        Cancel
      </button>
    </div>
  );
}
