import { useEffect, useRef } from 'react';

// Listens for fast keystroke streams typed by a USB barcode scanner. The
// classic heuristic: if a sequence of printable characters arrives in under
// `gapMs` between keystrokes and ends with Enter, treat it as a scan.
//
// The hook attaches a global keydown listener (window-level) so the cashier
// doesn't need to manually focus a hidden input. Existing text inputs and
// textareas are ignored so the cashier can still type normally.
//
// Options:
//   gapMs    — max delay (ms) between keystrokes to keep buffering (default 50)
//   minLen   — minimum scan length to fire (default 4)
//   enabled  — boolean toggle (default true)
//
// onScan(code, meta) is called with the captured text + meta about timing.
export function useBarcodeListener(onScan, { gapMs = 50, minLen = 4, enabled = true } = {}) {
  const bufferRef = useRef('');
  const lastAtRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    function isTypableTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function handler(e) {
      // Avoid hijacking modifier-keys or special keys.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      const dt = now - (lastAtRef.current || now);
      lastAtRef.current = now;

      if (e.key === 'Enter') {
        if (
          bufferRef.current.length >= minLen &&
          now - startedAtRef.current < 200
        ) {
          const code = bufferRef.current;
          bufferRef.current = '';
          startedAtRef.current = 0;
          // Only block the Enter when there was a buffered scan and we're not
          // focused inside a typable input (typing manually).
          if (!isTypableTarget(e.target)) e.preventDefault();
          onScan?.(code, { duration: now - startedAtRef.current });
        } else {
          bufferRef.current = '';
          startedAtRef.current = 0;
        }
        return;
      }

      // Only accept printable single-char keys.
      if (e.key.length !== 1) return;

      // If a typable element is focused AND the keystrokes are slow, let the
      // user type normally — do not buffer or capture.
      if (isTypableTarget(e.target) && dt > gapMs) {
        bufferRef.current = '';
        startedAtRef.current = 0;
        return;
      }

      if (!bufferRef.current.length) startedAtRef.current = now;

      // If a long gap, reset the buffer (likely manual typing).
      if (dt > gapMs && bufferRef.current.length > 0) {
        bufferRef.current = '';
        startedAtRef.current = now;
      }
      bufferRef.current += e.key;
    }

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onScan, gapMs, minLen, enabled]);
}
