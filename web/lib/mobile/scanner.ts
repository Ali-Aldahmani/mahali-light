import { RETAIL_FORMATS, validateRetailBarcode, type RetailFormat } from './barcode';

export type CameraErrorKind = 'permission-denied' | 'unavailable' | 'unsupported' | 'insecure';

export const CAMERA_ERROR_MESSAGES: Record<CameraErrorKind, string> = {
  'permission-denied':
    'Camera access is required to scan a barcode. You can allow camera access or enter the barcode manually.',
  unavailable: 'Camera is unavailable on this device.',
  unsupported: 'Barcode scanning is not supported on this browser. Enter the barcode manually.',
  insecure: 'The camera needs a secure (HTTPS) connection. Enter the barcode manually.',
};

export interface RetailDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string; format?: string }>>;
}

// Served from /public so scanning never depends on a CDN (LAN installs).
// Must stay byte-identical to node_modules/zxing-wasm — see scanner.test.ts.
export const ZXING_WASM_URL = '/vendor/zxing_reader.wasm';

/**
 * Native BarcodeDetector when it covers every retail format (Chrome/Edge on
 * Android, ChromeOS); otherwise the `barcode-detector` ponyfill (ZXing-C++
 * compiled to WASM, same API) for Safari/iOS and Firefox. Loaded lazily so
 * desktop bundles never pay for it. Returns null when neither can run.
 */
export async function createRetailDetector(): Promise<RetailDetector | null> {
  const Native = (globalThis as any).BarcodeDetector;
  if (Native && typeof Native.getSupportedFormats === 'function') {
    try {
      const supported: string[] = await Native.getSupportedFormats();
      if (RETAIL_FORMATS.every((f) => supported.includes(f))) {
        return new Native({ formats: RETAIL_FORMATS });
      }
    } catch (_e) {
      // fall through to the ponyfill
    }
  }
  try {
    const mod = await import('barcode-detector/ponyfill');
    await mod.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path,
      },
      fireImmediately: true,
    });
    return new mod.BarcodeDetector({ formats: RETAIL_FORMATS }) as unknown as RetailDetector;
  } catch (_e) {
    return null;
  }
}

export function classifyCameraError(err: unknown): CameraErrorKind {
  const name = (err as { name?: string } | null)?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'permission-denied';
  if (name === 'SecurityError') {
    return typeof window !== 'undefined' && window.isSecureContext === false
      ? 'insecure'
      : 'permission-denied';
  }
  return 'unavailable';
}

export interface ScannerCallbacks {
  onDetected: (code: string, format: RetailFormat) => void;
  onError: (kind: CameraErrorKind) => void;
  onReady?: () => void;
}

export interface ScannerDeps {
  createDetector?: () => Promise<RetailDetector | null>;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'> | null;
  isSecureContext?: boolean;
  intervalMs?: number;
}

export interface ScannerHandle {
  stop: () => void;
  isActive: () => boolean;
}

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

/**
 * Starts camera + detection on `video`. Fires `onDetected` at most once and
 * releases the camera before doing so. `stop()` is idempotent and safe to
 * call before the camera has even opened (e.g. unmount mid-permission-prompt).
 */
export function startScanner(
  video: HTMLVideoElement,
  cb: ScannerCallbacks,
  deps: ScannerDeps = {},
): ScannerHandle {
  const createDetector = deps.createDetector || createRetailDetector;
  const mediaDevices =
    deps.mediaDevices !== undefined
      ? deps.mediaDevices
      : typeof navigator !== 'undefined'
        ? navigator.mediaDevices
        : null;
  const secure =
    deps.isSecureContext ?? (typeof window !== 'undefined' ? window.isSecureContext !== false : true);
  const intervalMs = deps.intervalMs ?? 150;

  let stopped = false;
  let finished = false;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function releaseCamera() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    try {
      video.pause();
    } catch (_e) {
      /* jsdom / already detached */
    }
    video.srcObject = null;
  }

  function stop() {
    stopped = true;
    releaseCamera();
  }

  function fail(kind: CameraErrorKind) {
    if (stopped) return;
    stop();
    cb.onError(kind);
  }

  async function run() {
    if (!secure) return fail('insecure');
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return fail('unavailable');

    // Pick the decoder before prompting: no point asking for the camera on a
    // browser that can't read barcodes from it.
    const detector = await createDetector();
    if (stopped) return;
    if (!detector) return fail('unsupported');

    let s: MediaStream;
    try {
      s = await mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (err) {
      return fail(classifyCameraError(err));
    }
    if (stopped) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.srcObject = s;
    try {
      await video.play();
    } catch (_e) {
      // Autoplay refusal still leaves frames decodable on most engines.
    }
    if (stopped) return;
    cb.onReady?.();

    const tick = async () => {
      if (stopped || finished) return;
      if (video.readyState >= 2) {
        try {
          const results = await detector.detect(video);
          if (stopped || finished) return;
          for (const r of results || []) {
            const check = validateRetailBarcode(r.rawValue);
            if (check.ok) {
              finished = true;
              stop();
              cb.onDetected(check.code, check.format);
              return;
            }
          }
        } catch (_e) {
          // A bad frame isn't fatal — keep scanning.
        }
      }
      if (!stopped && !finished) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, 0);
  }

  run().catch(() => fail('unavailable'));

  return {
    stop,
    isActive: () => !stopped && !!stream,
  };
}
