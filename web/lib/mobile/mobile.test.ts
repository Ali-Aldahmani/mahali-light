import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyDevice } from './device';
import {
  desktopPathForMobile,
  hasAnyPermission,
  mobileAccess,
  phoneDecisionForDesktopPath,
} from './routePolicy';
import { expandUpcE, sanitizeBarcodeInput, validateRetailBarcode } from './barcode';
import { CAMERA_CONSTRAINTS, classifyCameraError, createRetailDetector, startScanner, ZXING_WASM_URL } from './scanner';
import { buildSimpleProductPayload, isDuplicateBarcodeError } from '@/lib/products/quickCreate';

const prepareZXingModule = vi.fn(async () => ({}));
const PolyfillDetector = vi.fn(function (this: any, opts: any) {
  this.opts = opts;
  this.detect = vi.fn(async () => []);
});
vi.mock('barcode-detector/ponyfill', () => ({
  prepareZXingModule: (...a: any[]) => (prepareZXingModule as any)(...a),
  BarcodeDetector: PolyfillDetector,
}));

describe('device classification (UX routing only)', () => {
  it('treats a touch phone as a phone', () => {
    expect(classifyDevice({ screenShortSide: 390, coarsePointer: true })).toBe('phone');
  });
  it('keeps tablets on the desktop experience', () => {
    expect(classifyDevice({ screenShortSide: 820, coarsePointer: true, uaDataMobile: false })).toBe('desktop');
    expect(classifyDevice({ screenShortSide: 744, coarsePointer: true, userAgent: 'iPad' })).toBe('desktop');
  });
  it('does not flip a desktop to phone just because of a small screen', () => {
    expect(classifyDevice({ screenShortSide: 480, coarsePointer: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('desktop');
    expect(classifyDevice({ screenShortSide: 1080, coarsePointer: false })).toBe('desktop');
  });
  it('accepts UA hints as a second signal, never alone', () => {
    expect(classifyDevice({ screenShortSide: 412, coarsePointer: false, uaDataMobile: true })).toBe('phone');
    expect(classifyDevice({ screenShortSide: 412, coarsePointer: false, userAgent: 'Linux; Android 14; Pixel 8 Mobile' })).toBe('phone');
    expect(classifyDevice({ screenShortSide: 1440, coarsePointer: false, uaDataMobile: true })).toBe('desktop');
  });
});

describe('mobile route policy', () => {
  const MANAGER = ['invoice.view', 'bills.view', 'analytics.view', 'analytics.view_dashboard', 'product.create'];

  it('allows supported routes when the permission is held', () => {
    for (const p of ['/m/dashboard', '/m/invoices', '/m/expenses', '/m/top-products', '/m/account', '/m/products/new', '/m/products/new/manual', '/m/products/new/details']) {
      expect(mobileAccess(p, MANAGER).kind).toBe('allowed');
    }
  });
  it('reports a permission restriction, not a device restriction', () => {
    expect(mobileAccess('/m/invoices', []).kind).toBe('permission-denied');
    expect(mobileAccess('/m/products/new', ['invoice.view']).kind).toBe('permission-denied');
    expect(mobileAccess('/m/products/new/details', ['product.view']).kind).toBe('permission-denied');
    expect(mobileAccess('/m/dashboard', []).kind).toBe('allowed');
    expect(mobileAccess('/m/account', []).kind).toBe('allowed');
  });
  it('honours the server-side wildcard', () => {
    expect(hasAnyPermission(['*'], ['product.create'])).toBe(true);
  });
  it('forwards phones on supported desktop URLs to their mobile counterpart', () => {
    expect(phoneDecisionForDesktopPath('/dashboard')).toEqual({ kind: 'redirect', to: '/m/dashboard' });
    expect(phoneDecisionForDesktopPath('/')).toEqual({ kind: 'redirect', to: '/m/dashboard' });
    expect(phoneDecisionForDesktopPath('/invoices/')).toEqual({ kind: 'redirect', to: '/m/invoices' });
    expect(phoneDecisionForDesktopPath('/expenses')).toEqual({ kind: 'redirect', to: '/m/expenses' });
    expect(phoneDecisionForDesktopPath('/products/new')).toEqual({ kind: 'redirect', to: '/m/products/new' });
  });
  it('marks every other desktop URL as Desktop Required', () => {
    for (const p of ['/users', '/team', '/settings', '/suppliers', '/reports', '/finance', '/products', '/products/abc/edit', '/products/abc', '/invoices/abc', '/pos', '/cashier', '/roles', '/analytics', '/expenses/bills/1']) {
      expect(phoneDecisionForDesktopPath(p)).toEqual({ kind: 'desktop-required' });
    }
  });
  it('sends desktop visitors of /m routes back to the desktop page', () => {
    expect(desktopPathForMobile('/m/invoices')).toBe('/invoices');
    expect(desktopPathForMobile('/m/products/new/details')).toBe('/products/new');
    expect(desktopPathForMobile('/m/unknown')).toBe('/dashboard');
  });
});

describe('retail barcode validation (shared by camera + manual)', () => {
  it('accepts valid EAN-13, EAN-8, UPC-A and UPC-E codes', () => {
    expect(validateRetailBarcode('6291007029871')).toEqual({ ok: true, code: '6291007029871', format: 'ean_13' });
    expect(validateRetailBarcode('4006381333931')).toMatchObject({ ok: true, format: 'ean_13' });
    expect(validateRetailBarcode('96385074')).toMatchObject({ ok: true, format: 'ean_8' });
    expect(validateRetailBarcode('036000291452')).toMatchObject({ ok: true, format: 'upc_a' });
    expect(validateRetailBarcode('04252614')).toMatchObject({ ok: true, format: 'upc_e' });
  });
  it('rejects wrong check digits, letters and unsupported lengths', () => {
    expect(validateRetailBarcode('4006381333932').ok).toBe(false);
    expect(validateRetailBarcode('036000291453').ok).toBe(false);
    expect(validateRetailBarcode('12345678').ok).toBe(false);
    expect(validateRetailBarcode('ABC123').ok).toBe(false);
    expect(validateRetailBarcode('1234567890').ok).toBe(false);
    expect(validateRetailBarcode('').ok).toBe(false);
  });
  it('expands UPC-E and sanitizes typed input', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(sanitizeBarcodeInput(' 629-1007 029871x99 ')).toBe('6291007029871');
  });
});

function fakeVideo() {
  const video = document.createElement('video');
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  video.play = vi.fn().mockResolvedValue(undefined) as any;
  video.pause = vi.fn() as any;
  return video;
}

function fakeCamera() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  return { track, stream, mediaDevices: { getUserMedia } };
}

describe('scanner engine', () => {
  afterEach(() => {
    delete (globalThis as any).BarcodeDetector;
    vi.clearAllMocks();
  });

  it('requests the rear camera, detects once, and releases the camera before reporting', async () => {
    const cam = fakeCamera();
    const video = fakeVideo();
    const detector = { detect: vi.fn(async () => [{ rawValue: '4006381333931' }, { rawValue: '96385074' }]) };
    let trackStoppedWhenReported = false;
    const onDetected = vi.fn(() => {
      trackStoppedWhenReported = cam.track.stop.mock.calls.length > 0;
    });
    const onReady = vi.fn();
    const handle = startScanner(
      video,
      { onDetected, onError: vi.fn(), onReady },
      { mediaDevices: cam.mediaDevices, createDetector: async () => detector, isSecureContext: true, intervalMs: 1 },
    );

    await vi.waitFor(() => expect(onDetected).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(cam.mediaDevices.getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect((CAMERA_CONSTRAINTS.video as any).facingMode).toEqual({ ideal: 'environment' });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith('4006381333931', 'ean_13');
    expect(trackStoppedWhenReported).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(detector.detect).toHaveBeenCalledTimes(1);
    expect(handle.isActive()).toBe(false);
  });

  it('ignores unreadable frames and non-retail values, then keeps scanning', async () => {
    const cam = fakeCamera();
    const outputs: any[] = [new Error('frame'), [{ rawValue: 'https://example.com' }], [], [{ rawValue: '036000291452' }]];
    const detector = {
      detect: vi.fn(async () => {
        const next = outputs.shift();
        if (next instanceof Error) throw next;
        return next || [];
      }),
    };
    const onDetected = vi.fn();
    const onError = vi.fn();
    startScanner(fakeVideo(), { onDetected, onError }, {
      mediaDevices: cam.mediaDevices, createDetector: async () => detector, isSecureContext: true, intervalMs: 1,
    });
    await vi.waitFor(() => expect(onDetected).toHaveBeenCalledWith('036000291452', 'upc_a'));
    expect(onError).not.toHaveBeenCalled();
    expect(detector.detect.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('stop() on leave releases the camera and stops detection', async () => {
    const cam = fakeCamera();
    const detector = { detect: vi.fn(async () => []) };
    const onReady = vi.fn();
    const handle = startScanner(fakeVideo(), { onDetected: vi.fn(), onError: vi.fn(), onReady }, {
      mediaDevices: cam.mediaDevices, createDetector: async () => detector, isSecureContext: true, intervalMs: 1,
    });
    await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
    handle.stop();
    const calls = detector.detect.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(cam.track.stop).toHaveBeenCalled();
    expect(detector.detect.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });

  it('stopping while the permission prompt is open closes the stream once granted', async () => {
    const cam = fakeCamera();
    let grant: (s: MediaStream) => void = () => {};
    cam.mediaDevices.getUserMedia.mockImplementationOnce(() => new Promise((r) => { grant = r; }));
    const onReady = vi.fn();
    const handle = startScanner(fakeVideo(), { onDetected: vi.fn(), onError: vi.fn(), onReady }, {
      mediaDevices: cam.mediaDevices, createDetector: async () => ({ detect: vi.fn(async () => []) }), isSecureContext: true,
    });
    await vi.waitFor(() => expect(cam.mediaDevices.getUserMedia).toHaveBeenCalled());
    handle.stop();
    grant(cam.stream);
    await new Promise((r) => setTimeout(r, 10));
    expect(cam.track.stop).toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });

  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'unavailable'],
    ['NotReadableError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
  ])('maps %s to %s', async (name, kind) => {
    const cam = fakeCamera();
    cam.mediaDevices.getUserMedia.mockRejectedValueOnce(Object.assign(new Error(name), { name }));
    const onError = vi.fn();
    startScanner(fakeVideo(), { onDetected: vi.fn(), onError }, {
      mediaDevices: cam.mediaDevices, createDetector: async () => ({ detect: vi.fn() }), isSecureContext: true,
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(kind));
    expect(classifyCameraError({ name })).toBe(kind);
  });

  it('reports unavailable when the browser has no camera API', async () => {
    const onError = vi.fn();
    startScanner(fakeVideo(), { onDetected: vi.fn(), onError }, { mediaDevices: null, isSecureContext: true });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('unavailable'));
  });

  it('reports unsupported without ever prompting for the camera', async () => {
    const cam = fakeCamera();
    const onError = vi.fn();
    startScanner(fakeVideo(), { onDetected: vi.fn(), onError }, {
      mediaDevices: cam.mediaDevices, createDetector: async () => null, isSecureContext: true,
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('unsupported'));
    expect(cam.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('refuses to open the camera outside a secure context', async () => {
    const cam = fakeCamera();
    const onError = vi.fn();
    startScanner(fakeVideo(), { onDetected: vi.fn(), onError }, { mediaDevices: cam.mediaDevices, isSecureContext: false });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('insecure'));
    expect(cam.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('detector selection', () => {
  afterEach(() => {
    delete (globalThis as any).BarcodeDetector;
    vi.clearAllMocks();
  });

  it('uses the native BarcodeDetector when it supports all retail formats', async () => {
    const Native = vi.fn(function (this: any, opts: any) { this.opts = opts; });
    (Native as any).getSupportedFormats = async () => ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e'];
    (globalThis as any).BarcodeDetector = Native;
    const d: any = await createRetailDetector();
    expect(Native).toHaveBeenCalledWith({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    expect(d.opts.formats).toHaveLength(4);
    expect(prepareZXingModule).not.toHaveBeenCalled();
  });

  it('falls back to the ZXing ponyfill served from /public (no CDN)', async () => {
    const d: any = await createRetailDetector();
    expect(d).toBeTruthy();
    expect(PolyfillDetector).toHaveBeenCalledWith({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const opts: any = (prepareZXingModule.mock.calls[0] as any[])[0];
    expect(opts.fireImmediately).toBe(true);
    expect(opts.overrides.locateFile('zxing_reader.wasm', 'https://cdn/')).toBe(ZXING_WASM_URL);
  });

  it('returns null when the ponyfill cannot load', async () => {
    prepareZXingModule.mockRejectedValueOnce(new Error('offline'));
    expect(await createRetailDetector()).toBeNull();
  });

  it('ships a WASM binary identical to the installed zxing-wasm', () => {
    const shipped = readFileSync(path.resolve(process.cwd(), 'public', ZXING_WASM_URL.slice(1)));
    const installed = readFileSync(path.resolve(process.cwd(), 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'));
    expect(shipped.equals(installed)).toBe(true);
  });
});

describe('quick product payload', () => {
  it('builds the POST /products simple-product shape', () => {
    expect(
      buildSimpleProductPayload({ name: '  Cola 330ml ', categoryId: 'c1', sellingPrice: 4.5, openingStock: 12, barcode: ' 6291007029871 ' }),
    ).toEqual({
      name: 'Cola 330ml',
      categoryId: 'c1',
      hasVariants: false,
      soldBy: 'piece',
      unitLabel: 'pcs',
      isActive: true,
      simple: { sellingPrice: 4.5, openingStock: 12, barcode: '6291007029871', sku: null, supplierBarcode: null },
    });
  });
  it('recognises the server duplicate-barcode conflict', () => {
    expect(isDuplicateBarcodeError({ status: 409, details: { field: 'barcode' } })).toBe(true);
    expect(isDuplicateBarcodeError({ status: 409, message: 'Barcode 123 is already in use.' })).toBe(true);
    expect(isDuplicateBarcodeError({ status: 409, details: { field: 'sku' }, message: 'SKU taken' })).toBe(false);
    expect(isDuplicateBarcodeError({ status: 400, details: { field: 'barcode' } })).toBe(false);
  });
});
