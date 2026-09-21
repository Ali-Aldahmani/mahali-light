/**
 * PDF browser-reuse regression test.
 *
 * pdfService caches one launched Puppeteer Browser instance across PDF jobs
 * and, on each subsequent call, checks it's still alive before reusing it.
 * That check called `browser.isConnected()` — a method Puppeteer removed in
 * favor of a `connected` getter in a later major version. Calling it threw
 * "browser.isConnected is not a function" on every SECOND PDF export within
 * a server process's lifetime (the first call always launches fresh, since
 * the cache starts empty, so this only ever surfaced on reuse) — reported
 * live against the app the moment the new custom-report PDF export was
 * tried a second time.
 *
 * This actually exercises Puppeteer (slower than a typical unit test, no
 * mocking) because a mock of the Browser API would hide exactly the kind
 * of real API-shape mismatch that caused the bug.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { renderPdf, closeBrowser } = require('../../server/services/pdfService.js');

describe('pdfService reuses a live browser across renders', () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it('renders a second PDF after the first without throwing', async () => {
    const first = await renderPdf('<html><body>First</body></html>');
    expect(first.length).toBeGreaterThan(0);

    // This second call is the one that previously threw
    // "browser.isConnected is not a function" against the cached instance.
    const second = await renderPdf('<html><body>Second</body></html>');
    expect(second.length).toBeGreaterThan(0);
  }, 30000);
});
