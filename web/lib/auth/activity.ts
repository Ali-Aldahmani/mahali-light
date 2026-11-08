// Real input on this screen: keyboard, mouse, touch, scroll wheel (a barcode
// scanner types, so it counts too). The server signs a session out after a
// set time without input (authentication audit AUTH-03); background requests
// and live updates don't count.

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

let lastInputAt = Date.now();
let reportedAt = 0;
let listening = false;
const listeners = new Set<() => void>();

function mark() {
  lastInputAt = Date.now();
  for (const cb of listeners) cb();
}

// Signing in is input. Tracking only starts once signed in, so the clock would
// otherwise still read when the page loaded: a till left on the login page for
// longer than the idle limit signed the next person straight back out.
export function markSessionStart() {
  lastInputAt = Date.now();
}

export function startActivityTracking() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  for (const ev of INPUT_EVENTS) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  }
}

export function lastInputTime(): number {
  return lastInputAt;
}

export function onInput(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// True for the first request after new input: that request tells the server
// someone is using the screen (X-User-Active).
export function takeInputForRequest(): boolean {
  if (lastInputAt <= reportedAt) return false;
  reportedAt = Date.now();
  return true;
}

// For tests.
export function resetActivity(now = Date.now()) {
  lastInputAt = now;
  reportedAt = 0;
}
