'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RetailFormat } from '@/lib/mobile/barcode';
import { startScanner, type CameraErrorKind, type ScannerDeps } from '@/lib/mobile/scanner';

export type ScanStatus = 'starting' | 'scanning' | 'paused' | 'detected' | 'error';

/**
 * Owns the camera for one scan screen. The camera is released on success,
 * on unmount (navigation), when the tab is hidden, and on pagehide — it is
 * never left running in the background. Detection fires once per session.
 */
export function useBarcodeScanner({
  onDetected,
  deps,
}: {
  onDetected: (code: string, format: RetailFormat) => void;
  deps?: ScannerDeps;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<ScanStatus>('starting');
  const [error, setError] = useState<CameraErrorKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const depsRef = useRef(deps);
  const detectedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || detectedRef.current) return undefined;
    setStatus('starting');
    setError(null);

    const handle = startScanner(
      video,
      {
        onReady: () => setStatus('scanning'),
        onError: (kind) => {
          setError(kind);
          setStatus('error');
        },
        onDetected: (code, format) => {
          if (detectedRef.current) return;
          detectedRef.current = true;
          setStatus('detected');
          onDetectedRef.current(code, format);
        },
      },
      depsRef.current,
    );

    let paused = false;
    const pause = () => {
      if (paused) return;
      paused = true;
      handle.stop();
      if (!detectedRef.current) setStatus('paused');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause();
      else if (paused && !detectedRef.current) setAttempt((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', pause);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', pause);
      handle.stop();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    if (!detectedRef.current) setAttempt((n) => n + 1);
  }, []);

  return { videoRef, status, error, retry };
}
