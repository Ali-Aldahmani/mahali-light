import { useSyncExternalStore } from 'react';

// Device classification is UX routing only. It decides which shell the
// browser renders; it is never an authorization signal — user agents and
// screen sizes are trivially spoofed, and Express re-checks every request.

export type DeviceClass = 'phone' | 'desktop' | 'unknown';

export interface DeviceSignals {
  /** Shorter edge of the physical screen in CSS px (orientation-independent). */
  screenShortSide: number;
  /** `(pointer: coarse)` — primary input is a finger. */
  coarsePointer: boolean;
  /** `navigator.userAgentData.mobile` when the browser exposes UA-CH. */
  uaDataMobile?: boolean | null;
  userAgent?: string;
}

// Phones top out around 430px on the short edge; the smallest tablets
// (iPad mini, 7" Android) start at ~600px. Tablets deliberately keep the
// desktop experience — they have the room for it.
export const PHONE_MAX_SHORT_SIDE = 599;

const PHONE_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|Mobi/i;

export function classifyDevice(s: DeviceSignals): Exclude<DeviceClass, 'unknown'> {
  if (!(s.screenShortSide > 0) || s.screenShortSide > PHONE_MAX_SHORT_SIDE) return 'desktop';
  const uaSaysPhone = s.uaDataMobile === true || PHONE_UA.test(s.userAgent || '');
  // A small screen alone isn't enough (a narrow desktop window, a tiny
  // laptop in portrait); it has to be touch-first or self-identify as mobile.
  return s.coarsePointer || uaSaysPhone ? 'phone' : 'desktop';
}

export function readDeviceSignals(): DeviceSignals | null {
  if (typeof window === 'undefined') return null;
  const scr = window.screen;
  const short = scr ? Math.min(scr.width || 0, scr.height || 0) : 0;
  const coarse = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
  const nav = window.navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    screenShortSide: short || Math.min(window.innerWidth, window.innerHeight),
    coarsePointer: coarse,
    uaDataMobile: nav.userAgentData?.mobile ?? null,
    userAgent: nav.userAgent,
  };
}

export function detectDeviceClass(): DeviceClass {
  const signals = readDeviceSignals();
  return signals ? classifyDevice(signals) : 'unknown';
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  mq?.addEventListener?.('change', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
    mq?.removeEventListener?.('change', onChange);
  };
}

export function useDeviceClass(): DeviceClass {
  return useSyncExternalStore(subscribe, detectDeviceClass, () => 'unknown');
}
